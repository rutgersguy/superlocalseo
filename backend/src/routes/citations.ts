import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient } from '../middleware/requireClient';
import { validateQuery } from '../middleware/validate';
import * as ctrl from '../controllers/citation.controller';

const router = Router();

router.get('/history', requireAuth, requireClient, validateQuery(ctrl.historyQuerySchema), ctrl.history);
router.get('/', requireAuth, requireClient, validateQuery(ctrl.listQuerySchema), ctrl.list);
router.post('/submit', requireAuth, requireClient, ctrl.submit);
router.get('/submissions', requireAuth, requireClient, ctrl.listSubmissions);

export default router;
