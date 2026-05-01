import { Router } from 'express';
import { requireClient, requireTeamAdmin } from '../middleware/requireClient';
import * as team from '../controllers/team.controller';

const router = Router();

// Authenticated, client-scoped routes
router.get('/', requireClient, team.list);
router.post('/invite', requireClient, requireTeamAdmin, team.invite);
router.delete('/:memberId', requireClient, requireTeamAdmin, team.remove);

// Public invite-acceptance routes (no auth required)
router.get('/accept', team.accept);
router.post('/accept', team.acceptConfirm);

export default router;
