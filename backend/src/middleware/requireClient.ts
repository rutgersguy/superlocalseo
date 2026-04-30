import { Request, Response, NextFunction } from 'express';
import { db } from '../db/connection';
import { requireAuth } from './auth';
import { notFound } from '../utils/response';

declare global {
  namespace Express {
    interface Request {
      clientId: string;
      client: Record<string, unknown>;
    }
  }
}

export async function requireClient(req: Request, res: Response, next: NextFunction): Promise<void> {
  // First ensure authenticated
  await new Promise<void>((resolve) => requireAuth(req, res, () => resolve()));
  // If requireAuth sent a response, stop here
  if (res.headersSent) return;

  try {
    const client = await db('clients').where({ user_id: req.userId }).first();
    if (!client) {
      notFound(res, 'Client record not found');
      return;
    }
    req.clientId = client.id as string;
    req.client = client as Record<string, unknown>;
    next();
  } catch (e) {
    next(e);
  }
}
