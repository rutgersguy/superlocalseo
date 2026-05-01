import { Job } from 'bullmq';
import { db } from '../db/connection';
import { sendTrialEndingSoonEmail } from '../services/email.service';
import { logger } from '../utils/logger';

// Fires daily — sends reminder at exactly 3 days remaining
export async function processTrialReminder(_job: Job): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);

  const expiring = await db('clients')
    .join('users', 'clients.user_id', 'users.id')
    .where('clients.subscription_status', 'trialing')
    .whereNull('clients.stripe_subscription_id')
    .whereBetween('clients.trial_ends_at', [windowStart, windowEnd])
    .select('clients.business_name', 'clients.trial_ends_at', 'users.email');

  logger.info('Trial reminder job', { count: expiring.length });

  for (const row of expiring as Array<{ business_name: string; trial_ends_at: string; email: string }>) {
    const msLeft = new Date(row.trial_ends_at).getTime() - now.getTime();
    const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
    await sendTrialEndingSoonEmail(row.email, row.business_name, daysLeft);
  }
}
