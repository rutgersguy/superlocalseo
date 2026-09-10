import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as collection from '../controllers/collection.controller';
const router = Router();
// Deliberately active in test environments too so abuse limits are exercised.
export const feedbackLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, validate: false, message: { success: false, error: { message: 'Too many submissions. Please try again later.', code: 'RATE_LIMITED' } } });
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); });
router.get('/:token', collection.view);
router.post('/:token/feedback', feedbackLimiter, collection.submit);
export default router;
