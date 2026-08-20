import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient } from '../middleware/requireClient';
import { validateQuery } from '../middleware/validate';
import * as ctrl from '../controllers/ai_visibility.controller';

const router = Router();

// Open to both plans — the payload itself is plan-aware. See the controller.
router.get('/', requireAuth, requireClient, validateQuery(ctrl.listQuerySchema), ctrl.summary);

// Pro-only via PLAN_ROUTE_GATES ('ai-visibility/answer').
router.get('/answer/:id', requireAuth, requireClient, ctrl.answer);

export default router;
