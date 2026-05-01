import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient, requireTeamAdmin } from '../middleware/requireClient';
import * as campaign from '../controllers/campaign.controller';

const router = Router();

router.get('/', requireClient, campaign.list);
router.get('/unsubscribes', requireAuth, requireClient, campaign.listUnsubscribes);
router.post('/:campaignId/invite', requireClient, requireTeamAdmin, campaign.invite);
router.post('/:campaignId/invite/bulk', requireClient, requireTeamAdmin, campaign.bulkInvite);

export default router;
