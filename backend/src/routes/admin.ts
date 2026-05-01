import { Router } from 'express';
import { requireAdmin } from '../middleware/auth';
import * as ctrl from '../controllers/admin.controller';

const router = Router();

router.get('/overview', requireAdmin, ctrl.overview);
router.get('/clients', requireAdmin, ctrl.clients);
router.get('/queues', requireAdmin, ctrl.queues);

export default router;
