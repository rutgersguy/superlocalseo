import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient } from '../middleware/requireClient';
import * as ctrl from '../controllers/reputation.controller';

const router = Router();
router.use(requireAuth, requireClient);

// NOTE: POST /reviews/:reviewId/reply is GONE. It called BrightLocal's /v4/rf/reply, and
// BrightLocal state plainly: "We don't support Review Response via API" (2026-07-14). It could
// never have worked — it never fired in prod only because no client has a BL reputation
// campaign. Replies publish through EMR now: POST /api/reviews/:id/publish.
router.post('/sync', ctrl.syncBLReviews);

export default router;
