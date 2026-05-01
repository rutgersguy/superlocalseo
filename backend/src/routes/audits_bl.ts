import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient } from '../middleware/requireClient';
import * as ctrl from '../controllers/audit_bl.controller';

const router = Router();
router.use(requireAuth, requireClient);

router.get('/', ctrl.list);
router.get('/location/:locationId/history', ctrl.history);
router.post('/generate', ctrl.trigger);
router.get('/:id', ctrl.get);

export default router;
