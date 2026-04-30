import rateLimit from 'express-rate-limit';
import { Request } from 'express';

const skip = (req: Request) =>
  process.env.NODE_ENV === 'test' || req.path.startsWith('/health');

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  validate: false,
  message: { success: false, error: { message: 'Too many requests', code: 'RATE_LIMITED' } },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  validate: false,
  message: { success: false, error: { message: 'Too many auth attempts', code: 'RATE_LIMITED' } },
});
