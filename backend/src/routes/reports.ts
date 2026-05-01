import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient } from '../middleware/requireClient';
import * as ctrl from '../controllers/report.controller';

const router = Router();

router.get('/', requireAuth, requireClient, ctrl.list);
router.get('/:id/download', requireAuth, requireClient, ctrl.download);
router.get('/:id/view', requireAuth, requireClient, ctrl.view);
router.post('/generate', requireAuth, requireClient, ctrl.generate);

export default router;
