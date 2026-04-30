import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient } from '../middleware/requireClient';
import { validate } from '../middleware/validate';
import * as ctrl from '../controllers/integration.controller';

const router = Router();

router.get('/', requireAuth, requireClient, ctrl.list);
router.post('/brightlocal', requireAuth, requireClient, validate(ctrl.brightlocalSchema), ctrl.connectBrightLocal);
router.post('/embedmyreviews', requireAuth, requireClient, validate(ctrl.embedmyreviewsSchema), ctrl.connectEmbedMyReviews);
router.delete('/:provider', requireAuth, requireClient, ctrl.disconnect);

export default router;
