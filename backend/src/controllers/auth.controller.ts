import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as authService from '../services/auth.service';
import { ok, created, noContent, err } from '../utils/response';
import { verifyRefreshToken } from '../utils/jwt';
import { config } from '../config';
import { logger } from '../utils/logger';

const registerSchema = z.object({
  email: z.string().email('Enter a valid email address (e.g. you@example.com)'),
  password: z.string().min(8, 'Password must be at least 8 characters — this helps keep your account secure'),
  businessName: z.string()
    .min(2, 'Business name must be at least 2 characters')
    .max(255, 'Business name is too long (max 255 characters)'),
});

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

const resetRequestSchema = z.object({ email: z.string().email('Enter a valid email address to receive your reset link') });
const resetConfirmSchema = z.object({
  token: z.string(),
  password: z.string().min(8, 'New password must be at least 8 characters'),
});

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
    const result = await authService.verifyEmail(token);
    ok(res, { message: result.alreadyVerified ? 'Email already verified' : 'Email verified', alreadyVerified: result.alreadyVerified });
  } catch (e) { next(e); }
}

export async function resendVerification(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    await authService.resendVerification(email);
    // Always a generic success — never reveal whether the account exists or is verified.
    ok(res, { message: 'If that account exists and is unverified, a new verification email is on its way.' });
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

export function googleAuthUrl(_req: Request, res: Response): void {
  const clientId = config.google?.clientId;
  if (!clientId) {
    err(res, 'Google OAuth not configured', 503, 'NOT_CONFIGURED');
    return;
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${config.publicUrl}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

export async function googleCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { code, error } = req.query as { code?: string; error?: string };
    if (error || !code) {
      res.redirect(`${config.appUrl}/login?error=google_cancelled`);
      return;
    }

    const clientId = config.google?.clientId;
    const clientSecret = config.google?.clientSecret;
    if (!clientId || !clientSecret) {
      res.redirect(`${config.appUrl}/login?error=not_configured`);
      return;
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${config.publicUrl}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      logger.error('Google auth token exchange failed', { status: tokenRes.status });
      res.redirect(`${config.appUrl}/login?error=google_failed`);
      return;
    }

    const tokens = await tokenRes.json() as { id_token: string };
    const profilePayload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString());
    const { sub: googleId, email, name } = profilePayload as { sub: string; email: string; name: string };

    const { accessToken, refreshToken, status } = await authService.googleSignIn(googleId, email, name);
    setRefreshCookie(res, refreshToken);
    const params = new URLSearchParams({ token: accessToken, status });
    res.redirect(`${config.appUrl}/auth/google/success?${params.toString()}`);
  } catch (e) {
    next(e);
  }
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/api/auth',
  });
}
