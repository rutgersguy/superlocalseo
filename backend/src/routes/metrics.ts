import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient } from '../middleware/requireClient';
import * as ctrl from '../controllers/metric.controller';

const router = Router();

router.get('/', requireAuth, requireClient, ctrl.get);

export default router;
