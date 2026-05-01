import { Request, Response, NextFunction } from 'express';
import { db } from '../db/connection';
import { requireAuth } from './auth';
import { notFound, forbidden } from '../utils/response';

declare global {
  namespace Express {
    interface Request {
      clientId: string;
      client: Record<string, unknown>;
      teamRole: string; // 'owner' | 'admin' | 'viewer'
    }
  }
}

export async function requireClient(req: Request, res: Response, next: NextFunction): Promise<void> {
  // First ensure authenticated
  await new Promise<void>((resolve) => requireAuth(req, res, () => resolve()));
  // If requireAuth sent a response, stop here
  if (res.headersSent) return;

  try {
    // Check if this user is the account owner
    let client = await db('clients').where({ user_id: req.userId }).first();
    if (client) {
      req.clientId = client.id as string;
      req.client = client as Record<string, unknown>;
      req.teamRole = 'owner';
      next();
      return;
    }

    // Check if this user is a team member on any client account
    const member = await db('team_members')
      .where({ user_id: req.userId })
      .whereNotNull('accepted_at')
      .first();

    if (!member) {
      notFound(res, 'Client record not found');
      return;
    }

    client = await db('clients').where({ id: member.client_id }).first();
    if (!client) {
      notFound(res, 'Client record not found');
      return;
    }

    req.clientId = client.id as string;
    req.client = client as Record<string, unknown>;
    req.teamRole = member.role as string;
    next();
  } catch (e) {
    next(e);
  }
}

export function requireTeamAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.teamRole !== 'owner' && req.teamRole !== 'admin') {
    forbidden(res, 'Admin access required');
    return;
  }
  next();
}
