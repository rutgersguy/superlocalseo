import { Router } from 'express';
import { requireAdmin } from '../middleware/auth';
import * as ctrl from '../controllers/admin.controller';
import { registerWebhook } from '../services/embedmyreviews.service';
import { config } from '../config';
import { logger } from '../utils/logger';

const router = Router();

router.get('/overview', requireAdmin, ctrl.overview);
router.get('/clients', requireAdmin, ctrl.clients);
router.get('/queues', requireAdmin, ctrl.queues);
router.get('/analytics', requireAdmin, ctrl.analytics);
router.post('/jobs/trigger', requireAdmin, ctrl.triggerJob);
router.get('/citations', requireAdmin, ctrl.citationsOverview);
router.get('/citations/locations', requireAdmin, ctrl.adminCitationLocations);
router.post('/citations/campaign', requireAdmin, ctrl.adminCreateCampaign);
router.get('/citations/campaign/:campaignId/lookup', requireAdmin, ctrl.adminGetCampaignLookup);
router.post('/citations/campaign/:campaignId/confirm', requireAdmin, ctrl.adminConfirmCampaign);
router.get('/citations/campaign/:campaignId', requireAdmin, ctrl.adminGetCampaign);

router.get('/customers', requireAdmin, ctrl.adminListCustomers);
router.patch('/customers/:clientId', requireAdmin, ctrl.adminUpdateCustomer);
router.delete('/customers/:clientId', requireAdmin, ctrl.adminDeleteCustomer);

router.get('/promos', requireAdmin, ctrl.adminListPromoCodes);
router.post('/promos', requireAdmin, ctrl.adminCreatePromoCode);
router.delete('/promos/:promoId', requireAdmin, ctrl.adminDeactivatePromoCode);

// Register the EMR agency-level webhook so all customer events push to us
router.post('/emr/register-webhook', requireAdmin, async (_req, res) => {
  const apiKey = config.embedmyreviews.apiKey;
  if (!apiKey) {
    res.status(400).json({ success: false, error: 'EMBEDMYREVIEWS_API_KEY not configured' });
    return;
  }
  const webhookUrl = `${config.publicUrl}/webhooks/emr`;
  logger.info('Registering EMR webhook', { webhookUrl });
  const ok = await registerWebhook(apiKey, webhookUrl);
  if (ok) {
    res.json({ success: true, webhookUrl });
  } else {
    res.status(502).json({ success: false, error: 'EMR returned non-OK response — check API key and plan' });
  }
});

export default router;
