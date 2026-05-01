import { Router } from 'express';
import { requireClient, requireTeamAdmin } from '../middleware/requireClient';
import * as qr from '../controllers/qr.controller';

const router = Router();

// Public redirect (no auth)
router.get('/r/:code', qr.redirect);

// Authenticated routes
router.get('/', requireClient, qr.list);
router.post('/', requireClient, requireTeamAdmin, qr.create);
router.delete('/:id', requireClient, requireTeamAdmin, qr.remove);
router.get('/:id/image.png', requireClient, qr.image);

export default router;
