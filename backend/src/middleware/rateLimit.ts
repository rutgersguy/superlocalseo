import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../db/redis';

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({ sendCommand: (...args: string[]) => redis.call(...args as [string, ...string[]]) }),
  message: { success: false, error: { message: 'Too many requests', code: 'RATE_LIMITED' } },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({ sendCommand: (...args: string[]) => redis.call(...args as [string, ...string[]]) }),
  message: { success: false, error: { message: 'Too many auth attempts', code: 'RATE_LIMITED' } },
});
