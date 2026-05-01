import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient } from '../middleware/requireClient';
import * as ctrl from '../controllers/reputation.controller';

const router = Router();
router.use(requireAuth, requireClient);

router.post('/reviews/:reviewId/reply', ctrl.reply);
router.post('/sync', ctrl.syncBLReviews);

export default router;
