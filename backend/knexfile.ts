import type { Knex } from 'knex';
import dotenv from 'dotenv';
dotenv.config();

const config: { [env: string]: Knex.Config } = {
  development: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    migrations: { directory: './src/db/migrations', extension: 'ts' },
    seeds: { directory: './src/db/seeds', extension: 'ts' },
  },
  test: {
    client: 'pg',
    connection: process.env.DATABASE_URL || 'postgresql://slseo:slseo@localhost:5432/superlocalseo_test',
    migrations: { directory: './src/db/migrations', extension: 'ts' },
    seeds: { directory: './src/db/seeds', extension: 'ts' },
  },
  production: {
    client: 'pg',
    connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } },
    migrations: { directory: './src/db/migrations', extension: 'ts' },
    pool: { min: 2, max: 10 },
  },
};

export default config;
