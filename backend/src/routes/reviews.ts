import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient } from '../middleware/requireClient';
import { validateQuery } from '../middleware/validate';
import { aiLimiter } from '../middleware/rateLimit';
import { verifyEmrWebhook } from '../middleware/verifyEmrWebhook';
import * as ctrl from '../controllers/review.controller';
import * as responseCtrl from '../controllers/review_response.controller';

const router = Router();

// Webhook has no auth — verified via HMAC signature (verifyEmrWebhook)
router.post('/webhook', verifyEmrWebhook, ctrl.webhook);

router.get('/', requireAuth, requireClient, validateQuery(ctrl.listQuerySchema), ctrl.list);
router.get('/feedback', requireAuth, requireClient, ctrl.listFeedback);

// AI response drafting
router.get('/:id/response', requireAuth, requireClient, responseCtrl.get);
router.post('/:id/response/draft', aiLimiter, requireAuth, requireClient, responseCtrl.draft);
router.patch('/:id/response', requireAuth, requireClient, responseCtrl.update);
// Publishes the reply live on Google via EMR (the only API that can — BrightLocal cannot).
router.post('/:id/publish', requireAuth, requireClient, responseCtrl.publish);

export default router;
