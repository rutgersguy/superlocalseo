import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient } from '../middleware/requireClient';
import { validateQuery } from '../middleware/validate';
import * as ctrl from '../controllers/citation.controller';

const router = Router();

router.get('/history', requireAuth, requireClient, validateQuery(ctrl.historyQuerySchema), ctrl.history);
router.get('/', requireAuth, requireClient, validateQuery(ctrl.listQuerySchema), ctrl.list);
router.get('/submissions', requireAuth, requireClient, ctrl.listSubmissions);

// Citation Builder Management API v1 endpoints
router.get('/credits', requireAuth, requireClient, ctrl.getCbCreditsHandler);
router.post('/campaign', requireAuth, requireClient, ctrl.createCampaign);
router.get('/campaign/:campaignId/lookup', requireAuth, requireClient, ctrl.getCampaignLookup);
router.post('/campaign/:campaignId/confirm', requireAuth, requireClient, ctrl.confirmCampaign);
router.get('/campaign/:campaignId', requireAuth, requireClient, ctrl.getCampaignStatus);

export default router;
