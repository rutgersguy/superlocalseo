import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

export const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on('error', (err) => logger.error('Redis error', { error: err.message }));
redis.on('connect', () => logger.info('Redis connected'));

export async function checkRedisConnection(): Promise<boolean> {
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

// Refresh token helpers
const REFRESH_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

export async function storeRefreshToken(userId: string, tokenId: string): Promise<void> {
  await redis.setex(`refresh:${userId}:${tokenId}`, REFRESH_TTL, '1');
}

export async function validateRefreshToken(userId: string, tokenId: string): Promise<boolean> {
  const val = await redis.get(`refresh:${userId}:${tokenId}`);
  return val === '1';
}

export async function revokeRefreshToken(userId: string, tokenId: string): Promise<void> {
  await redis.del(`refresh:${userId}:${tokenId}`);
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  const keys = await redis.keys(`refresh:${userId}:*`);
  if (keys.length > 0) await redis.del(...keys);
}
