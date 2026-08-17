import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { redis, storeRefreshToken, validateRefreshToken, revokeRefreshToken, revokeAllRefreshTokens } from '../db/redis';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { sendVerificationEmail, sendPasswordResetEmail, sendWelcomeEmail } from './email.service';
import { logger } from '../utils/logger';

const SALT_ROUNDS = 12;
const VERIFY_TTL = 24 * 60 * 60;
const RESET_TTL = 60 * 60;

export async function register(email: string, password: string, businessName: string) {
  const existing = await db('users').where({ email }).first();
  if (existing) {
    const hint = existing.google_id && !existing.password_hash ? 'google' : 'password';
    throw Object.assign(new Error('Email already in use'), { status: 409, code: 'EMAIL_TAKEN', hint });
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // No Stripe call here, deliberately. This used to await a Stripe customer creation
  // unguarded, so a Stripe outage or a rejected key returned 500 and NOBODY could
  // sign up — before any row was written, so there was nothing to recover either
  // (issue #177). Note the email sends below are already tolerated with .catch();
  // Stripe was the one external dependency that could take signup down.
  //
  // The customer is created lazily at checkout instead, which is the only place
  // it is needed — trials run 7 days with no card. billing.controller already
  // calls getOrCreateStripeCustomer() on both checkout paths, so nothing else
  // has to change.
  const [user] = await db('users').insert({ email, password_hash: passwordHash, role: 'client' }).returning('*');
  const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const [client] = await db('clients').insert({ user_id: user.id, business_name: businessName, subscription_tier: 1, subscription_status: 'trialing', trial_ends_at: trialEndsAt }).returning('*');

  // Send verification + welcome emails
  const verifyToken = uuidv4();
  await redis.setex(`verify:${verifyToken}`, VERIFY_TTL, user.id);
  await sendVerificationEmail(email, verifyToken).catch(() => {});
  void sendWelcomeEmail(email, businessName);

  logger.info('User registered', { userId: user.id, clientId: client.id });
  return { user, client };
}

export async function login(email: string, password: string) {
  const user = await db('users').where({ email }).first();
  if (!user) throw Object.assign(new Error('No account found with that email'), { status: 401, code: 'USER_NOT_FOUND' });

  if (!user.password_hash) {
    // Google-only account — no password set
    throw Object.assign(new Error('This account uses Google sign-in'), { status: 401, code: 'USE_GOOGLE_LOGIN' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw Object.assign(new Error('Invalid credentials'), { status: 401, code: 'INVALID_CREDENTIALS' });

  // Email verification is a soft nudge, not a gate — unverified users can still sign in
  // and use the app (an in-app banner prompts them to verify). We never block entry.
  return issueTokens(user.id, user.role);
}

/**
 * Re-send the verification email for an unverified account. Silent for unknown or
 * already-verified emails so it never reveals whether an account exists.
 */
export async function resendVerification(email: string): Promise<void> {
  const user = await db('users').where({ email }).first();
  if (!user || user.email_verified) return;
  const verifyToken = uuidv4();
  await redis.setex(`verify:${verifyToken}`, VERIFY_TTL, user.id);
  await sendVerificationEmail(email, verifyToken).catch(() => {});
}

export async function refresh(refreshToken: string) {
  let payload;
  try { payload = verifyRefreshToken(refreshToken); }
  catch { throw Object.assign(new Error('Invalid refresh token'), { status: 401 }); }

  const valid = await validateRefreshToken(payload.userId, payload.tokenId);
  if (!valid) throw Object.assign(new Error('Refresh token revoked'), { status: 401 });

  await revokeRefreshToken(payload.userId, payload.tokenId);
  const user = await db('users').where({ id: payload.userId }).first();
  if (!user) throw Object.assign(new Error('User not found'), { status: 401 });

  return issueTokens(user.id, user.role);
}

export async function logout(userId: string, tokenId: string): Promise<void> {
  await revokeRefreshToken(userId, tokenId);
}

export async function verifyEmail(token: string): Promise<{ alreadyVerified: boolean }> {
  const userId = await redis.get(`verify:${token}`);
  if (!userId) throw Object.assign(new Error('This verification link is invalid or has expired.'), { status: 400 });

  const user = await db('users').where({ id: userId }).first();
  if (user?.email_verified) return { alreadyVerified: true };

  await db('users').where({ id: userId }).update({ email_verified: true });
  // Intentionally do NOT delete the token here. Email link-prefetchers / safe-link
  // scanners (Outlook, Gmail, corporate gateways) issue an automated GET before the
  // human clicks; deleting on first hit made the real click — and StrictMode's dev
  // double-fire — fail with "invalid/expired", which dead-ended users into re-registering
  // (the reported "account already exists"). The token expires on its own 24h TTL.
  return { alreadyVerified: false };
}

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await db('users').where({ email }).first();
  if (!user) return; // Silent — don't reveal whether email exists
  const token = uuidv4();
  await redis.setex(`reset:${token}`, RESET_TTL, user.id);
  await sendPasswordResetEmail(email, token).catch(() => {});
}

export async function confirmPasswordReset(token: string, newPassword: string): Promise<void> {
  const userId = await redis.get(`reset:${token}`);
  if (!userId) throw Object.assign(new Error('Invalid or expired reset link'), { status: 400 });
  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await db('users').where({ id: userId }).update({ password_hash: hash });
  await redis.del(`reset:${token}`);
  await revokeAllRefreshTokens(userId);
}

export async function googleSignIn(googleId: string, email: string, displayName: string) {
  let user = await db('users').where({ google_id: googleId }).first();
  let status: 'new' | 'linked' | 'existing' = 'existing';

  if (!user) {
    user = await db('users').where({ email }).first();
    if (user) {
      // Existing email account — link Google identity
      await db('users').where({ id: user.id }).update({ google_id: googleId });
      status = 'linked';
    } else {
      // Brand-new user via Google
      // Same reasoning as the password path above — no Stripe on the signup
      // critical path; the customer is created lazily at checkout (#177).
      const [newUser] = await db('users').insert({
        email,
        google_id: googleId,
        password_hash: null,
        role: 'client',
        email_verified: true,
      }).returning('*');
      await db('clients').insert({
        user_id: newUser.id,
        business_name: displayName,
        subscription_tier: 1,
        subscription_status: 'trialing',
        trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      user = newUser;
      status = 'new';
      logger.info('User registered via Google OAuth', { userId: newUser.id });
    }
  }

  const tokens = await issueTokens(user.id, user.role);
  return { ...tokens, status };
}

export async function issueTokens(userId: string, role: string) {
  const tokenId = uuidv4();
  const accessToken = signAccessToken({ userId, role });
  const refreshToken = signRefreshToken({ userId, tokenId });
  await storeRefreshToken(userId, tokenId);
  return { accessToken, refreshToken, tokenId };
}
