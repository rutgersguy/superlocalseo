import { Router } from 'express';
import { checkDbConnection } from '../db/connection';
import { checkRedisConnection } from '../db/redis';

const router = Router();

// Liveness — always 200 if process is running
router.get('/live', (_req, res) => {
  res.json({ status: 'ok' });
});

// Readiness — checks downstream dependencies
router.get('/ready', async (_req, res) => {
  const [db, redisOk] = await Promise.all([checkDbConnection(), checkRedisConnection()]);
  const status = db && redisOk ? 200 : 503;
  res.status(status).json({ status: status === 200 ? 'ok' : 'degraded', db, redis: redisOk });
});

export default router;
