import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient } from '../middleware/requireClient';
import * as ctrl from '../controllers/geogrid.controller';

const router = Router();
router.use(requireAuth, requireClient);

router.post('/', ctrl.trigger);
router.get('/', ctrl.list);
router.get('/:id', ctrl.get);

export default router;
