import { Router } from 'express';
import { requireClient, requireTeamAdmin } from '../middleware/requireClient';
import * as competitor from '../controllers/competitor.controller';

const router = Router();

router.get('/', requireClient, competitor.list);
router.get('/gap', requireClient, competitor.gap);
router.get('/search', requireClient, competitor.search);
router.post('/', requireClient, requireTeamAdmin, competitor.create);
router.delete('/:id', requireClient, requireTeamAdmin, competitor.remove);
router.post('/:id/sync', requireClient, requireTeamAdmin, competitor.sync);

export default router;
