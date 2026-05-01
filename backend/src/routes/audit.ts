import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as ctrl from '../controllers/audit.controller';

const auditLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV !== 'production',
  validate: false,
  message: { success: false, error: { message: 'Too many audit requests — try again later', code: 'RATE_LIMITED' } },
});

const router = Router();

router.post('/scan', auditLimiter, ctrl.scan);
router.post('/capture', ctrl.capture);

export default router;
