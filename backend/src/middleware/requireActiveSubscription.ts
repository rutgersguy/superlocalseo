import { Request, Response, NextFunction } from 'express';
import { db } from '../db/connection';

export async function requireActiveSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Admins are never blocked
    const user = await db('users').where({ id: req.userId }).first();
    if (user?.role === 'admin') { next(); return; }

    const client = await db('clients').where({ user_id: req.userId }).first();
    if (!client) { next(); return; }

    const status = client.subscription_status as string;
    if (status === 'active') { next(); return; }

    if (status === 'trialing') {
      const trialEndsAt = client.trial_ends_at ? new Date(client.trial_ends_at as string) : null;
      if (!trialEndsAt || trialEndsAt > new Date()) { next(); return; }
      // Trial expired
      res.status(402).json({ success: false, error: { code: 'TRIAL_EXPIRED', message: 'Your trial has ended. Please subscribe to continue.' } });
      return;
    }

    if (status === 'past_due') {
      res.status(402).json({ success: false, error: { code: 'PAYMENT_FAILED', message: 'Your payment failed. Please update your billing details.' } });
      return;
    }

    if (status === 'canceled') {
      res.status(402).json({ success: false, error: { code: 'SUBSCRIPTION_CANCELLED', message: 'Your subscription has been cancelled.' } });
      return;
    }

    next();
  } catch (e) {
    next(e);
  }
}
