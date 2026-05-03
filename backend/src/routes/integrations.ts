import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient, requireTeamAdmin } from '../middleware/requireClient';
import * as ctrl from '../controllers/integration.controller';

const router = Router();

router.get('/', requireAuth, requireClient, ctrl.list);
router.get('/google/auth-url', requireAuth, requireClient, requireTeamAdmin, ctrl.getGoogleAuthUrl);
router.get('/google/callback', ctrl.googleCallback);
router.get('/facebook/auth-url', requireAuth, requireClient, requireTeamAdmin, ctrl.getFacebookAuthUrl);
router.get('/facebook/callback', ctrl.facebookCallback);
router.delete('/:provider', requireAuth, requireClient, requireTeamAdmin, ctrl.disconnect);

export default router;
