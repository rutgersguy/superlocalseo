import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient } from '../middleware/requireClient';
import { validate, validateQuery } from '../middleware/validate';
import * as ctrl from '../controllers/keyword.controller';

const router = Router();

router.get('/', requireAuth, requireClient, validateQuery(ctrl.keywordQuerySchema), ctrl.list);
router.post('/', requireAuth, requireClient, validate(ctrl.keywordSchema), ctrl.create);
router.delete('/:id', requireAuth, requireClient, ctrl.remove);

export default router;
