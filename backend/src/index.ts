import app from './app';
import { config } from './config';
import { logger } from './utils/logger';
import { db } from './db/connection';
import { redis } from './db/redis';
import { startWorkers } from './jobs/queue';

process.on('unhandledRejection', (reason, promise) => {
  process.stderr.write(`UNHANDLED REJECTION at ${String(promise)}: ${String(reason)}\n`);
  if (reason instanceof Error) process.stderr.write(reason.stack + '\n');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  process.stderr.write(`UNCAUGHT EXCEPTION: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});


async function start() {
  // Connect Redis
  await redis.connect().catch((e) => logger.warn('Redis connect warning', { error: e.message }));

  // Verify DB
  try {
    await db.raw('SELECT 1');
    logger.info('Database connected');
  } catch (e) {
    logger.error('Database connection failed — exiting', { error: e });
    process.exit(1);
  }

  const server = app.listen(config.port, () => {
    logger.info(`SuperLocalSEO API running`, { port: config.port, env: config.env });
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    logger.error('Server failed to start', { error: err.message, code: err.code });
    process.exit(1);
  });

  // Start BullMQ workers (skip in test env or if DISABLE_WORKERS is set)
  if (process.env.NODE_ENV !== 'test' && !process.env.DISABLE_WORKERS) {
    try {
      await startWorkers();
      logger.info('Background workers started');
    } catch (e) {
      logger.warn('Failed to start background workers', { error: (e as Error).message });
    }
  }
}

start().catch((e) => {
  logger.error('Startup failed', { error: e });
  process.exit(1);
});
