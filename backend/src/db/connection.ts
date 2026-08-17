import knex from 'knex';
import { config } from '../config';
import { logger } from '../utils/logger';

// When running the built image this file is dist/db/connection.js, so migrations
// are the compiled .js alongside it. In dev (ts-node) they are the .ts sources.
//
// `loadExtensions` is not cosmetic: tsconfig emits `declaration: true`, so
// dist/db/migrations contains a .d.ts and two .map files per migration. knex's
// default loadExtensions includes '.ts', so without this it would try to require
// every .d.ts as a migration.
const isCompiled = __filename.endsWith('.js');
const migrationExt = isCompiled ? 'js' : 'ts';

export const db = knex({
  client: 'pg',
  connection: config.db.url,
  pool: { min: 2, max: 10 },
  acquireConnectionTimeout: 10000,
  migrations: {
    directory: __dirname + '/migrations',
    extension: migrationExt,
    loadExtensions: [`.${migrationExt}`],
  },
});

export async function checkDbConnection(): Promise<boolean> {
  try {
    await db.raw('SELECT 1');
    return true;
  } catch (e) {
    logger.error('Database connection failed', { error: e });
    return false;
  }
}
