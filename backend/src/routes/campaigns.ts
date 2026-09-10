import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient, requireTeamAdmin } from '../middleware/requireClient';
import * as campaign from '../controllers/campaign.controller';

import * as setup from '../controllers/campaign_setup.controller';

import * as collection from '../controllers/collection.controller';
import { clientHistory } from '../controllers/campaign_history.controller';
const router = Router();
router.get('/history', requireClient, clientHistory);
router.get('/collection', requireClient, collection.status);
router.post('/collection/:locationId', requireClient, requireTeamAdmin, collection.issue);
router.get('/collection/:locationId/qr.png', requireClient, collection.image);
router.get('/setup', requireAuth, requireClient, setup.setupStatus);
router.post('/setup', requireAuth, requireClient, requireTeamAdmin, setup.requestSetup);

router.get('/', requireClient, campaign.list);
router.post('/', requireClient, requireTeamAdmin, campaign.create);
router.get('/unsubscribes', requireAuth, requireClient, campaign.listUnsubscribes);
router.get('/credits', requireAuth, requireClient, campaign.getCredits);
router.get('/templates', requireAuth, requireClient, campaign.listTemplates);
router.post('/:campaignId/invite', requireClient, requireTeamAdmin, campaign.invite);
router.post('/:campaignId/invite/bulk', requireClient, requireTeamAdmin, campaign.bulkInvite);

export default router;
