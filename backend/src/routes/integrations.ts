import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient, requireTeamAdmin } from '../middleware/requireClient';
import * as ctrl from '../controllers/integration.controller';

const router = Router();

router.get('/', requireAuth, requireClient, ctrl.list);

// Google via EMR's approved GBP access — the working path. (Our own /google/auth-url below
// stays mounted but is inert until Google grants our GBP API quota.)
router.get('/emr/google/connect-link', requireAuth, requireClient, ctrl.getEmrGoogleConnectLink);
router.post('/emr/google/connect-link', requireAuth, requireClient, requireTeamAdmin, ctrl.createEmrGoogleConnectLink);

router.get('/google/auth-url', requireAuth, requireClient, requireTeamAdmin, ctrl.getGoogleAuthUrl);
router.get('/google/callback', ctrl.googleCallback);
router.get('/facebook/auth-url', requireAuth, requireClient, requireTeamAdmin, ctrl.getFacebookAuthUrl);
router.get('/facebook/callback', ctrl.facebookCallback);
router.delete('/:provider', requireAuth, requireClient, requireTeamAdmin, ctrl.disconnect);

export default router;
