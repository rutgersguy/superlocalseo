import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireClient, requireTeamAdmin } from '../middleware/requireClient';
import * as widget from '../controllers/widget.controller';

const router = Router();

// Authenticated — manage widget settings (must come before /:key public route)
router.get('/', requireClient, widget.getWidget);
router.patch('/', requireClient, requireTeamAdmin, widget.updateWidget);
router.post('/regenerate', requireClient, requireTeamAdmin, widget.regenerateKey);
router.get('/:id/config', requireAuth, requireClient, widget.getConfig);
router.put('/:id/config', requireAuth, requireClient, requireTeamAdmin, widget.updateConfig);

// Public — called by embeddable widget.js from third-party sites
router.options('/:key', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.sendStatus(204);
});
router.get('/:key', widget.publicWidget);

export default router;
