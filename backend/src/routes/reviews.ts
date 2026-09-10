import {status as syncStatus} from '../controllers/review_sync.controller';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient, requireTeamAdmin } from '../middleware/requireClient';
import { validateQuery } from '../middleware/validate';
import { aiLimiter } from '../middleware/rateLimit';
import { handleEmrWebhook } from '../controllers/emr_webhook.controller';
import { verifyEmrWebhook } from '../middleware/verifyEmrWebhook';
import * as ctrl from '../controllers/review.controller';
import * as responseCtrl from '../controllers/review_response.controller';

const router = Router();

// Webhook has no auth — verified via HMAC signature (verifyEmrWebhook)
// Legacy URL kept because it may still be the one registered in EMR. It now
// runs the SAME authenticated handler as /webhooks/emr rather than a second,
// divergent copy that matched on the wrong column and dropped everything (#148).
router.post('/webhook', verifyEmrWebhook, handleEmrWebhook);

router.get('/', requireAuth, requireClient, validateQuery(ctrl.listQuerySchema), ctrl.list);
router.get('/sync-status', requireAuth, requireClient, syncStatus);
router.get('/feedback', requireAuth, requireClient, ctrl.listFeedback);

// AI response drafting
router.get('/:id/response', requireAuth, requireClient, responseCtrl.get);
router.post('/:id/response/draft', aiLimiter, requireAuth, requireClient, requireTeamAdmin, responseCtrl.draft);
router.patch('/:id/response', requireAuth, requireClient, requireTeamAdmin, responseCtrl.update);
// Publishes the reply live on Google via EMR (the only API that can — BrightLocal cannot).
router.post('/:id/publish', requireAuth, requireClient, requireTeamAdmin, responseCtrl.publish);

router.post('/:id/reconcile', requireAuth, requireClient, requireTeamAdmin, responseCtrl.reconcile);

export default router;
