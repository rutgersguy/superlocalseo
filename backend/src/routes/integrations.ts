import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient } from '../middleware/requireClient';
import * as ctrl from '../controllers/integration.controller';

const router = Router();

router.get('/', requireAuth, requireClient, ctrl.list);
router.get('/google/auth-url', requireAuth, requireClient, ctrl.getGoogleAuthUrl);
router.get('/google/callback', ctrl.googleCallback);
router.get('/facebook/auth-url', requireAuth, requireClient, ctrl.getFacebookAuthUrl);
router.get('/facebook/callback', ctrl.facebookCallback);
router.delete('/:provider', requireAuth, requireClient, ctrl.disconnect);

export default router;
