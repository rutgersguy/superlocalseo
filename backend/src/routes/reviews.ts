import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient } from '../middleware/requireClient';
import { validateQuery } from '../middleware/validate';
import { aiLimiter } from '../middleware/rateLimit';
import * as ctrl from '../controllers/review.controller';
import * as responseCtrl from '../controllers/review_response.controller';

const router = Router();

// Webhook has no auth — uses HMAC
router.post('/webhook', ctrl.webhook);

router.get('/', requireAuth, requireClient, validateQuery(ctrl.listQuerySchema), ctrl.list);
router.get('/feedback', requireAuth, requireClient, ctrl.listFeedback);

// AI response drafting
router.get('/:id/response', requireAuth, requireClient, responseCtrl.get);
router.post('/:id/response/draft', aiLimiter, requireAuth, requireClient, responseCtrl.draft);
router.patch('/:id/response', requireAuth, requireClient, responseCtrl.update);

export default router;
