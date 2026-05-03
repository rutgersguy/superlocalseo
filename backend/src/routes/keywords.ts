import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient, requireTeamAdmin } from '../middleware/requireClient';
import { validate, validateQuery } from '../middleware/validate';
import * as ctrl from '../controllers/keyword.controller';

const router = Router();

router.get('/', requireAuth, requireClient, validateQuery(ctrl.keywordQuerySchema), ctrl.list);
router.post('/', requireAuth, requireClient, requireTeamAdmin, validate(ctrl.keywordSchema), ctrl.create);
router.patch('/:id/volume', requireAuth, requireClient, requireTeamAdmin, ctrl.updateVolume);
router.delete('/:id', requireAuth, requireClient, requireTeamAdmin, ctrl.remove);

export default router;
