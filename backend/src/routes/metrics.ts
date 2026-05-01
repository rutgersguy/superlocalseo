import { Router, Request, Response } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { requireClient } from '../middleware/requireClient';
import { registry } from '../middleware/metrics';
import * as ctrl from '../controllers/metric.controller';

const router = Router();

router.get('/', requireAuth, requireClient, ctrl.get);
router.get('/visibility', requireAuth, requireClient, ctrl.visibilityScore);

// Prometheus scrape endpoint — admin-only
router.get('/prom', requireAdmin, async (_req: Request, res: Response) => {
  res.setHeader('Content-Type', registry.contentType);
  res.send(await registry.metrics());
});

export default router;
