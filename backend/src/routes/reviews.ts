import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient } from '../middleware/requireClient';
import { validateQuery } from '../middleware/validate';
import * as ctrl from '../controllers/review.controller';

const router = Router();

// Webhook has no auth — uses HMAC
router.post('/webhook', ctrl.webhook);

router.get('/', requireAuth, requireClient, validateQuery(ctrl.listQuerySchema), ctrl.list);

export default router;
