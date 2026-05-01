import { Router } from 'express';
import { requireClient, requireTeamAdmin } from '../middleware/requireClient';
import * as widget from '../controllers/widget.controller';

const router = Router();

// Public — called by embeddable widget.js from third-party sites
router.options('/:key', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.sendStatus(204);
});
router.get('/:key', widget.publicWidget);

// Authenticated — manage widget settings
router.get('/', requireClient, widget.getWidget);
router.patch('/', requireClient, requireTeamAdmin, widget.updateWidget);
router.post('/regenerate', requireClient, requireTeamAdmin, widget.regenerateKey);

export default router;
