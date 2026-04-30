import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as authService from '../services/auth.service';
import { ok, created, noContent } from '../utils/response';
import { verifyRefreshToken } from '../utils/jwt';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  businessName: z.string().min(2).max(255),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const resetRequestSchema = z.object({ email: z.string().email() });
const resetConfirmSchema = z.object({ token: z.string(), password: z.string().min(8) });

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password, businessName } = registerSchema.parse(req.body);
    const result = await authService.register(email, password, businessName);
    created(res, { userId: result.user.id, clientId: result.client.id });
  } catch (e) { next(e); }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const { accessToken, refreshToken } = await authService.login(email, password);
    setRefreshCookie(res, refreshToken);
    ok(res, { accessToken });
  } catch (e) { next(e); }
}

export async function refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) { res.status(401).json({ success: false, error: { message: 'No refresh token' } }); return; }
    const { accessToken, refreshToken: newRefresh } = await authService.refresh(token);
    setRefreshCookie(res, newRefresh);
    ok(res, { accessToken });
  } catch (e) { next(e); }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.refreshToken;
    if (token) {
      try {
        const payload = verifyRefreshToken(token);
        await authService.logout(payload.userId, payload.tokenId);
      } catch { /* expired token — still clear cookie */ }
    }
    res.clearCookie('refreshToken');
    noContent(res);
  } catch (e) { next(e); }
}

export async function verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = z.object({ token: z.string() }).parse(req.query);
    await authService.verifyEmail(token);
    ok(res, { message: 'Email verified' });
  } catch (e) { next(e); }
}

export async function passwordResetRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email } = resetRequestSchema.parse(req.body);
    await authService.requestPasswordReset(email);
    ok(res, { message: 'If that email exists, a reset link has been sent' });
  } catch (e) { next(e); }
}

export async function passwordResetConfirm(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token, password } = resetConfirmSchema.parse(req.body);
    await authService.confirmPasswordReset(token, password);
    ok(res, { message: 'Password updated' });
  } catch (e) { next(e); }
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/api/auth',
  });
}
