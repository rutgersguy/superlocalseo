import { Router } from 'express';
import { requireAdmin } from '../middleware/auth';
import * as ctrl from '../controllers/admin.controller';

const router = Router();

router.get('/overview', requireAdmin, ctrl.overview);
router.get('/clients', requireAdmin, ctrl.clients);
router.get('/queues', requireAdmin, ctrl.queues);
router.get('/analytics', requireAdmin, ctrl.analytics);
router.post('/jobs/trigger', requireAdmin, ctrl.triggerJob);

export default router;
