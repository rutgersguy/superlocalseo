import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient, requireTeamAdmin } from '../middleware/requireClient';
import { requireSourceAccess } from '../middleware/requireProPlan';
import * as ctrl from '../controllers/report.controller';

const router = Router();

router.get('/', requireAuth, requireClient, ctrl.list);
router.get('/export/rankings', requireAuth, requireClient, ctrl.exportRankings);
router.get('/export/keywords', requireAuth, requireClient, ctrl.exportKeywords);
router.get('/export/reviews', requireAuth, requireClient, ctrl.exportReviews);
// Gated by what it EXPORTS, not by where it lives. /citations is Pro-only, and
// this returns the same rows — it 200'd for Lite accounts until this was added.
router.get('/export/citations', requireAuth, requireClient, requireSourceAccess('citations'), ctrl.exportCitations);
router.get('/:id/download', requireAuth, requireClient, ctrl.download);
router.get('/:id/view', requireAuth, requireClient, ctrl.view);
router.post('/generate', requireAuth, requireClient, requireTeamAdmin, ctrl.generate);

export default router;
