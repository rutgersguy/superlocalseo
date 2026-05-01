import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient } from '../middleware/requireClient';
import { validate } from '../middleware/validate';
import * as ctrl from '../controllers/client.controller';

const router = Router();

router.get('/', requireAuth, requireClient, ctrl.getClient);
router.patch('/', requireAuth, requireClient, validate(ctrl.patchSchema), ctrl.updateClient);
router.post('/complete-onboarding', requireAuth, requireClient, ctrl.completeOnboarding);
router.post('/retry-emr-provision', requireAuth, requireClient, ctrl.retryProvision);

export default router;
