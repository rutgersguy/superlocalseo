import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId = uuidv4();
  const start = Date.now();
  req.headers['x-request-id'] = requestId;

  res.on('finish', () => {
    logger.info('request', {
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Date.now() - start,
      userId: (req as any).userId ?? null,
      ip: req.ip,
    });
  });

  next();
}
