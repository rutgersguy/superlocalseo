import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient, requireTeamAdmin } from '../middleware/requireClient';
import { validate } from '../middleware/validate';
import * as ctrl from '../controllers/location.controller';

const router = Router();

router.get('/', requireAuth, requireClient, ctrl.list);
router.post('/', requireAuth, requireClient, requireTeamAdmin, validate(ctrl.locationSchema), ctrl.create);
router.post('/:id/provision', requireAuth, requireClient, requireTeamAdmin, ctrl.provision);
router.patch('/:id', requireAuth, requireClient, requireTeamAdmin, validate(ctrl.locationPatchSchema), ctrl.update);
router.delete('/:id', requireAuth, requireClient, requireTeamAdmin, ctrl.remove);

export default router;
