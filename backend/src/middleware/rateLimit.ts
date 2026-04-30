import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../db/redis';

const skip = () => process.env.NODE_ENV === 'test';

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  store: new RedisStore({ sendCommand: ((...args: string[]) => redis.call(...args as [string, ...string[]])) as any }),
  message: { success: false, error: { message: 'Too many requests', code: 'RATE_LIMITED' } },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  store: new RedisStore({ sendCommand: ((...args: string[]) => redis.call(...args as [string, ...string[]])) as any }),
  message: { success: false, error: { message: 'Too many auth attempts', code: 'RATE_LIMITED' } },
});
