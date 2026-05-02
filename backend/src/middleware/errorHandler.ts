import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    const fields: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.');
      fields[key] = [...(fields[key] ?? []), issue.message];
    }
    res.status(422).json({ success: false, error: { message: 'Validation failed', code: 'VALIDATION_ERROR', fields } });
    return;
  }

  const status = (err as any)?.status ?? 500;
  const message = status < 500 ? (err as any).message : 'Internal server error';

  if (status >= 500) {
    logger.error('Unhandled error', { error: err, path: req.path, method: req.method });
  }

  const extra = (err as any)?.hint ? { hint: (err as any).hint } : {};
  res.status(status).json({ success: false, error: { message, code: (err as any)?.code ?? 'SERVER_ERROR', ...extra } });
}
