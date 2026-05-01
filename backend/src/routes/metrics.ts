import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/auth';
import { registry } from '../middleware/metrics';

const router = Router();

// Prometheus scrape endpoint — admin-only
router.get('/', requireAdmin, async (_req: Request, res: Response) => {
  res.setHeader('Content-Type', registry.contentType);
  res.send(await registry.metrics());
});

export default router;
