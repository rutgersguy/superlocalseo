import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient } from '../middleware/requireClient';
import { validate } from '../middleware/validate';
import * as ctrl from '../controllers/billing.controller';

const router = Router();

router.get('/', requireAuth, requireClient, ctrl.status);
router.post('/subscribe', requireAuth, requireClient, validate(ctrl.subscribeSchema), ctrl.subscribe);
router.post('/portal', requireAuth, requireClient, ctrl.portal);

export default router;
