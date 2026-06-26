import { Router } from 'express';
import express from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient, requireTeamAdmin } from '../middleware/requireClient';
import * as ctrl from '../controllers/billing.controller';

const router = Router();

// Webhook must receive raw body before JSON parsing
router.post('/webhook', express.raw({ type: 'application/json' }), ctrl.webhook);

router.get('/status', requireAuth, requireClient, ctrl.status);
router.post('/subscription-intent', requireAuth, requireClient, ctrl.subscriptionIntent);
router.post('/validate-promo', requireAuth, ctrl.validatePromo);
router.post('/checkout', requireAuth, requireClient, ctrl.checkout);
router.post('/upgrade', requireAuth, requireClient, requireTeamAdmin, ctrl.upgrade);
router.post('/portal', requireAuth, requireClient, ctrl.portal);

export default router;
