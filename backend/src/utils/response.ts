import { Response } from 'express';

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: { message: string; code?: string; fields?: Record<string, string[]> };
}

export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ success: true, data } satisfies ApiSuccess<T>);
}

export function created<T>(res: Response, data: T): void {
  ok(res, data, 201);
}

export function noContent(res: Response): void {
  res.status(204).end();
}

export function err(res: Response, message: string, status = 400, code?: string, fields?: Record<string, string[]>): void {
  res.status(status).json({ success: false, error: { message, code, fields } } satisfies ApiError);
}

export function unauthorized(res: Response, message = 'Unauthorized'): void {
  err(res, message, 401, 'UNAUTHORIZED');
}

export function forbidden(res: Response, message = 'Forbidden'): void {
  err(res, message, 403, 'FORBIDDEN');
}

export function notFound(res: Response, message = 'Not found'): void {
  err(res, message, 404, 'NOT_FOUND');
}

export function serverError(res: Response, message = 'Internal server error'): void {
  err(res, message, 500, 'SERVER_ERROR');
}
