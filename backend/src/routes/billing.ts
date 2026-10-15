import { Router } from 'express';
import express from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient, requireTeamAdmin } from '../middleware/requireClient';
import * as ctrl from '../controllers/billing.controller';

const router = Router();

// Webhook must receive raw body before JSON parsing
router.post('/webhook', express.raw({ type: 'application/json' }), ctrl.webhook);

router.get('/catalog', ctrl.planCatalog);
router.get('/status', requireAuth, requireClient, ctrl.status);
router.post('/subscription-preview', requireAuth, requireClient, requireTeamAdmin, ctrl.subscriptionPreview);
router.post('/subscription-intent', requireAuth, requireClient, requireTeamAdmin, ctrl.subscriptionIntent);
router.post('/validate-promo', requireAuth, ctrl.validatePromo);
router.post('/checkout', requireAuth, requireClient, ctrl.checkout);
router.post('/changes/preview', requireAuth, requireClient, requireTeamAdmin, ctrl.previewChange);
router.post('/changes/:id/setup', requireAuth, requireClient, requireTeamAdmin, ctrl.setupCard);
router.post('/changes/:id/confirm', requireAuth, requireClient, requireTeamAdmin, ctrl.confirmChange);
router.get('/changes/pending', requireAuth, requireClient, requireTeamAdmin, ctrl.pendingChange);
router.delete('/changes/:id', requireAuth, requireClient, requireTeamAdmin, ctrl.cancelChange);
router.get('/changes/:id', requireAuth, requireClient, requireTeamAdmin, ctrl.changeStatus);
router.post('/upgrade', requireAuth, requireClient, requireTeamAdmin, ctrl.upgrade);
router.post('/portal', requireAuth, requireClient, requireTeamAdmin, ctrl.portal);

export default router;
