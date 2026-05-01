import { Router } from 'express';
import { authLimiter } from '../middleware/rateLimit';
import * as ctrl from '../controllers/auth.controller';

const router = Router();

router.post('/register', authLimiter, ctrl.register);
router.post('/login', authLimiter, ctrl.login);
router.post('/refresh', ctrl.refreshToken);
router.post('/logout', ctrl.logout);
router.get('/verify', ctrl.verifyEmail);
router.post('/password-reset/request', authLimiter, ctrl.passwordResetRequest);
router.post('/password-reset/confirm', authLimiter, ctrl.passwordResetConfirm);
router.get('/google', ctrl.googleAuthUrl);
router.get('/google/callback', ctrl.googleCallback);

export default router;
