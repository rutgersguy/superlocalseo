import { Router } from 'express';
import { requireAdmin } from '../middleware/auth';
import * as ctrl from '../controllers/admin.controller';

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

export default router;
