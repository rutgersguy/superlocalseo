/**
 * Migration runner for the built production image.
 *
 * The old runbook was `docker exec superlocalseo-api npx knex migrate:latest`.
 * That cannot work once the API runs from `dist/`: the production image installs
 * with `--omit=dev` (no knex CLI, no ts-node) and never copies `knexfile.ts`.
 *
 * This entry reuses the app's own knex instance, so it shares one connection
 * config with the running API and cannot drift from it.
 *
 *   docker exec superlocalseo-api node dist/db/migrate.js          # apply
 *   docker exec superlocalseo-api node dist/db/migrate.js status   # report only
 *   docker exec superlocalseo-api node dist/db/migrate.js rollback # undo last batch
 */
import { db } from './connection';
import { logger } from '../utils/logger';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'latest';

  if (command === 'status') {
    const [completed, pending] = await Promise.all([
      db.migrate.list().then((r) => r[0] as string[]),
      db.migrate.list().then((r) => r[1] as { file: string }[]),
    ]);
    logger.info('Migration status', {
      applied: completed.length,
      pending: pending.length,
      pendingFiles: pending.map((p) => p.file),
    });
    return;
  }

  if (command === 'rollback') {
    const [batch, files] = await db.migrate.rollback();
    logger.info('Rollback complete', { batch, count: (files as string[]).length, files });
    return;
  }

  if (command !== 'latest') {
    throw new Error(`Unknown command "${command}". Use: latest | status | rollback`);
  }

  const [batch, files] = await db.migrate.latest();
  const applied = files as string[];
  if (applied.length === 0) {
    logger.info('Migrations already up to date — nothing to apply');
  } else {
    logger.info('Migrations applied', { batch, count: applied.length, files: applied });
  }
}

main()
  .then(async () => {
    await db.destroy();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error('Migration failed', { error: err instanceof Error ? err.message : String(err) });
    await db.destroy();
    process.exit(1);
  });
