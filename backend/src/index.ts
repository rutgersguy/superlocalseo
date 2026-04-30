import app from './app';
import { config } from './config';
import { logger } from './utils/logger';
import { db } from './db/connection';
import { redis } from './db/redis';

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

  app.listen(config.port, () => {
    logger.info(`SuperLocalSEO API running`, { port: config.port, env: config.env });
  });
}

start().catch((e) => {
  logger.error('Startup failed', { error: e });
  process.exit(1);
});
