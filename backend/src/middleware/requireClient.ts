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

const GRACE_PERIOD_DAYS = 3;

// Routes always accessible regardless of payment status
const BILLING_EXEMPT_PREFIXES = ['/billing', '/auth', '/health', '/clients'];

function checkBillingAccess(req: Request, res: Response, client: Record<string, unknown>): boolean {
  if (BILLING_EXEMPT_PREFIXES.some((p) => req.path.startsWith(p))) return true;

  const status = client.subscription_status as string | undefined;

  if (status === 'trialing') {
    const trialEndsAt = client.trial_ends_at ? new Date(client.trial_ends_at as string) : null;
    if (trialEndsAt && trialEndsAt < new Date()) {
      res.status(402).json({ success: false, error: 'Your free trial has ended. Subscribe to continue.', code: 'TRIAL_EXPIRED' });
      return false;
    }
  }

  if (status === 'canceled') {
    res.status(402).json({ success: false, error: 'Your subscription has been canceled. Resubscribe to continue.', code: 'SUBSCRIPTION_CANCELED' });
    return false;
  }

  if (status === 'past_due') {
    const failedAt = client.payment_failed_at ? new Date(client.payment_failed_at as string) : null;
    if (failedAt) {
      const elapsedDays = (Date.now() - failedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (elapsedDays > GRACE_PERIOD_DAYS) {
        res.status(402).json({
          success: false,
          error: 'Payment overdue. Please update your payment method to restore access.',
          code: 'PAYMENT_OVERDUE',
          daysOverdue: Math.floor(elapsedDays),
        });
        return false;
      }
    }
  }

  return true;
}

export async function requireClient(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Idempotent: if a parent-level requireClient already populated the request
  // (e.g. mounted at the router index ahead of requireProPlan), skip the work —
  // requireAuth, the client lookup, and the billing check have already run.
  // NB: key off req.clientId (our own field), NOT req.client — Node aliases
  // req.client to the TCP socket, so it is always truthy before we set it.
  if (req.clientId) { next(); return; }

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
      if (!checkBillingAccess(req, res, req.client)) return;
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
    if (!checkBillingAccess(req, res, req.client)) return;
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
