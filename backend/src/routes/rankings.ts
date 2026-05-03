import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient, requireTeamAdmin } from '../middleware/requireClient';
import { validateQuery } from '../middleware/validate';
import * as ctrl from '../controllers/ranking.controller';

const router = Router();

router.get('/', requireAuth, requireClient, validateQuery(ctrl.listQuerySchema), ctrl.list);
router.get('/trend', requireAuth, requireClient, validateQuery(ctrl.trendQuerySchema), ctrl.trend);
router.post('/sync', requireAuth, requireClient, requireTeamAdmin, ctrl.sync);

export default router;
