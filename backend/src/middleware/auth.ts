import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { unauthorized } from '../utils/response';

declare global {
  namespace Express {
    interface Request {
      userId: string;
      userRole: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) { unauthorized(res); return; }

  const token = header.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.userId;
    req.userRole = payload.role;
    next();
  } catch {
    unauthorized(res, 'Invalid or expired token');
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.userRole !== 'admin') { res.status(403).json({ success: false, error: { message: 'Admin only', code: 'FORBIDDEN' } }); return; }
    next();
  });
}
