import { Router } from 'express';
import express from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient } from '../middleware/requireClient';
import * as ctrl from '../controllers/billing.controller';

const router = Router();

// Webhook must receive raw body before JSON parsing
router.post('/webhook', express.raw({ type: 'application/json' }), ctrl.webhook);

router.get('/status', requireAuth, requireClient, ctrl.status);
router.post('/checkout', requireAuth, requireClient, ctrl.checkout);
router.post('/portal', requireAuth, requireClient, ctrl.portal);

export default router;
