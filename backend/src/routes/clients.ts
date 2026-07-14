import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient, requireTeamAdmin } from '../middleware/requireClient';
import { validate } from '../middleware/validate';
import * as ctrl from '../controllers/client.controller';

const router = Router();

router.get('/', requireAuth, requireClient, ctrl.getClient);
router.patch('/', requireAuth, requireClient, requireTeamAdmin, validate(ctrl.patchSchema), ctrl.updateClient);
router.post('/complete-onboarding', requireAuth, requireClient, requireTeamAdmin, ctrl.completeOnboarding);
router.post('/retry-emr-provision', requireAuth, requireClient, requireTeamAdmin, ctrl.retryProvision);
// GET /emr-credentials REMOVED (2026-07-14): it handed out a login to the client's EMR
// sub-account, whose data our agency key cannot read. Following it was a dead end — the
// client would link Google there and see nothing here, forever. Google now connects via
// the branded connect-link (GET/POST /integrations/emr/google/connect-link).

export default router;
