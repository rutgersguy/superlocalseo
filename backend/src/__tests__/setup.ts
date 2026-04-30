import { db } from '../db/connection';
import { redis } from '../db/redis';

beforeAll(async () => {
  await db.migrate.latest();
});

afterAll(async () => {
  await db.destroy();
  redis.disconnect();
});
