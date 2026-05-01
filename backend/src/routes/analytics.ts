import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient } from '../middleware/requireClient';
import { validateQuery } from '../middleware/validate';
import * as ctrl from '../controllers/analytics.controller';

const router = Router();

router.get('/rankings/history', requireAuth, requireClient, validateQuery(ctrl.rankingsHistorySchema), ctrl.rankingsHistory);
router.get('/reviews/trend', requireAuth, requireClient, validateQuery(ctrl.reviewsTrendSchema), ctrl.reviewsTrend);
router.get('/export', requireAuth, requireClient, ctrl.exportCsv);
router.get('/roi', requireAuth, requireClient, ctrl.roi);
router.patch('/roi-config', requireAuth, requireClient, ctrl.updateRoiConfig);

export default router;
