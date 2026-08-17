import rateLimit from 'express-rate-limit';
import { Request } from 'express';

const isDev = process.env.NODE_ENV === 'development';

const skip = (req: Request) =>
  isDev || process.env.NODE_ENV === 'test' || req.path.startsWith('/health');

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
  // Skips test as well as dev — generalLimiter and aiLimiter already did, and
  // authLimiter not doing so was an oversight. Every e2e spec authenticates, and
  // the whole suite runs from one IP, so 10 requests per 15 minutes trips
  // part-way through and reports failures that are not app defects (issue #164).
  skip: () => isDev || process.env.NODE_ENV === 'test',
  validate: false,
  message: { success: false, error: { message: 'Too many auth attempts', code: 'RATE_LIMITED' } },
});

// AI draft endpoints: 20 per 10 min per IP (Claude Haiku calls are metered)
export const aiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDev || process.env.NODE_ENV === 'test',
  validate: false,
  keyGenerator: (req) => (req as Request).ip ?? 'unknown',
  message: { success: false, error: { message: 'Too many AI requests, please wait', code: 'RATE_LIMITED' } },
});
