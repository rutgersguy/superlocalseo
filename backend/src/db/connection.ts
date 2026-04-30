import knex from 'knex';
import { config } from '../config';
import { logger } from '../utils/logger';

export const db = knex({
  client: 'pg',
  connection: config.db.url,
  pool: { min: 2, max: 10 },
  acquireConnectionTimeout: 10000,
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
