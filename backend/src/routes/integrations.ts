import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient, requireTeamAdmin } from '../middleware/requireClient';
import * as ctrl from '../controllers/integration.controller';

const router = Router();

router.get('/', requireAuth, requireClient, ctrl.list);

// Google via EMR's approved GBP access — still available as a fallback.
//
// Our OWN GBP path below is no longer inert: Google granted the Business
// Profile API quota (2026-08), so /google/auth-url is now the direct route and
// does not depend on EMR being in the middle.
router.get('/emr/google/connect-link', requireAuth, requireClient, ctrl.getEmrGoogleConnectLink);
router.post('/emr/google/connect-link', requireAuth, requireClient, requireTeamAdmin, ctrl.createEmrGoogleConnectLink);

router.get('/google/auth-url', requireAuth, requireClient, requireTeamAdmin, ctrl.getGoogleAuthUrl);
router.get('/google/callback', ctrl.googleCallback);
// Live status — calls Google rather than reporting a stored flag.
router.get('/google/status', requireAuth, requireClient, ctrl.googleStatus);
router.get('/facebook/auth-url', requireAuth, requireClient, requireTeamAdmin, ctrl.getFacebookAuthUrl);
router.get('/facebook/callback', ctrl.facebookCallback);
router.delete('/:provider', requireAuth, requireClient, requireTeamAdmin, ctrl.disconnect);

export default router;
