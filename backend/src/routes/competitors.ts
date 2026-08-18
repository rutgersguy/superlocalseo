import { Router } from 'express';
import { requireClient, requireTeamAdmin } from '../middleware/requireClient';
import * as competitor from '../controllers/competitor.controller';

const router = Router();

router.get('/', requireClient, competitor.list);
router.get('/gap', requireClient, competitor.gap);
// Review-count deltas — the input to "your competitor gained 18 reviews this month".
router.get('/review-trend', requireClient, competitor.reviewTrend);
router.get('/head-to-head', requireClient, competitor.headToHead);
router.get('/search', requireClient, competitor.search);
router.post('/', requireClient, requireTeamAdmin, competitor.create);
router.get('/scan-status', requireClient, competitor.scanStatus);
router.post('/sync-rankings', requireClient, requireTeamAdmin, competitor.syncRankings);
router.delete('/:id', requireClient, requireTeamAdmin, competitor.remove);
router.post('/:id/sync', requireClient, requireTeamAdmin, competitor.sync);
router.get('/:id/discover-keywords', requireClient, competitor.discoverKeywords);

// Discovered, not declared (#81) — Pro, and listed in PLAN_ROUTE_GATES because
// the `competitors` prefix is lite+pro for the teaser list, so a new route here
// defaults to Lite-visible unless named.
router.get('/outranking', requireClient, competitor.outranking);

export default router;
