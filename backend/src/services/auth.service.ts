import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { redis, storeRefreshToken, validateRefreshToken, revokeRefreshToken, revokeAllRefreshTokens } from '../db/redis';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { createCustomer, createSubscription } from './stripe.service';
import { sendVerificationEmail, sendPasswordResetEmail } from './email.service';
import { logger } from '../utils/logger';

const SALT_ROUNDS = 12;
const VERIFY_TTL = 24 * 60 * 60;
const RESET_TTL = 60 * 60;

export async function register(email: string, password: string, businessName: string) {
  const existing = await db('users').where({ email }).first();
  if (existing) throw Object.assign(new Error('Email already in use'), { status: 409, code: 'EMAIL_TAKEN' });

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const stripeCustomerId = await createCustomer(email, businessName);

  const [user] = await db('users').insert({ email, password_hash: passwordHash, role: 'client', stripe_customer_id: stripeCustomerId }).returning('*');
  const [client] = await db('clients').insert({ user_id: user.id, business_name: businessName, subscription_tier: 1, subscription_status: 'trialing' }).returning('*');

  // Send verification email
  const verifyToken = uuidv4();
  await redis.setex(`verify:${verifyToken}`, VERIFY_TTL, user.id);
  await sendVerificationEmail(email, verifyToken).catch(() => {});

  logger.info('User registered', { userId: user.id, clientId: client.id });
  return { user, client };
}

export async function login(email: string, password: string) {
  const user = await db('users').where({ email }).first();
  if (!user) throw Object.assign(new Error('Invalid credentials'), { status: 401, code: 'INVALID_CREDENTIALS' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw Object.assign(new Error('Invalid credentials'), { status: 401, code: 'INVALID_CREDENTIALS' });

  return issueTokens(user.id, user.role);
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

export async function verifyEmail(token: string): Promise<void> {
  const userId = await redis.get(`verify:${token}`);
  if (!userId) throw Object.assign(new Error('Invalid or expired verification link'), { status: 400 });
  await db('users').where({ id: userId }).update({ email_verified: true });
  await redis.del(`verify:${token}`);
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

  if (!user) {
    user = await db('users').where({ email }).first();
    if (user) {
      await db('users').where({ id: user.id }).update({ google_id: googleId });
    } else {
      const stripeCustomerId = await createCustomer(email, displayName);
      const [newUser] = await db('users').insert({
        email,
        google_id: googleId,
        password_hash: null,
        role: 'client',
        stripe_customer_id: stripeCustomerId,
        email_verified: true,
      }).returning('*');
      await db('clients').insert({
        user_id: newUser.id,
        business_name: displayName,
        subscription_tier: 1,
        subscription_status: 'trialing',
      });
      user = newUser;
      logger.info('User registered via Google OAuth', { userId: newUser.id });
    }
  }

  return issueTokens(user.id, user.role);
}

export async function issueTokens(userId: string, role: string) {
  const tokenId = uuidv4();
  const accessToken = signAccessToken({ userId, role });
  const refreshToken = signRefreshToken({ userId, tokenId });
  await storeRefreshToken(userId, tokenId);
  return { accessToken, refreshToken, tokenId };
}
