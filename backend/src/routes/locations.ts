import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient } from '../middleware/requireClient';
import { validate } from '../middleware/validate';
import * as ctrl from '../controllers/location.controller';

const router = Router();

router.get('/', requireAuth, requireClient, ctrl.list);
router.post('/', requireAuth, requireClient, validate(ctrl.locationSchema), ctrl.create);
router.patch('/:id', requireAuth, requireClient, validate(ctrl.locationPatchSchema), ctrl.update);
router.delete('/:id', requireAuth, requireClient, ctrl.remove);

export default router;
