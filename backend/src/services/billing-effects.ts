import { db } from '../db/connection';
import { sendPaymentFailedEmail } from './email.service';
import { deprovisionClient } from './emr_provisioning';
import { logger } from '../utils/logger';

// Database effects and this outbox commit with the webhook receipt. External
// effects run afterwards, so a receipt-insert failure cannot send an email.
export async function processBillingEffects(): Promise<void> {
  const rows = await db('billing_effects').whereNull('completed_at').where(q => q.whereNull('error').orWhereNot('error', 'Delivery uncertain beyond idempotency window; operator review required.')).orderBy('created_at').limit(50);
  for (const row of rows) {
    // Persist the first attempt before the external call. Resend retains keys
    // for 24 hours; ambiguous older sends require operator review, not a resend.
    await db('billing_effects').where({ id: row.id }).whereNull('attempted_at').update({ attempted_at: new Date() });
    await db.transaction(async trx => {
      const effect = await trx('billing_effects').where({ id: row.id }).forUpdate().skipLocked().first();
      if (!effect || effect.completed_at) return;
      if (effect.kind === 'payment_failed' && Date.now() - new Date(effect.attempted_at).getTime() > 23 * 3600000) {
        await trx('billing_effects').where({ id: row.id }).update({ error: 'Delivery uncertain beyond idempotency window; operator review required.' });
        return;
      }
      try {
        const client = await trx('clients').where({ id: effect.payload.clientId }).forUpdate().first();
        const expectedStatus = effect.kind === 'deprovision' ? 'canceled' : 'past_due';
        if (!client || client.stripe_subscription_id !== effect.payload.subscriptionId || client.subscription_status !== expectedStatus) {
          await trx('billing_effects').where({ id: row.id }).update({ completed_at: new Date(), error: null });
          return; // A newer payment or subscription superseded this effect.
        }
        if (effect.kind === 'payment_failed') await sendPaymentFailedEmail(effect.payload.email, effect.payload.businessName, effect.id);
        else if (effect.kind === 'deprovision') await deprovisionClient(effect.payload.clientId, trx);
        else throw new Error('Unknown billing effect');
        await trx('billing_effects').where({ id: row.id }).update({ completed_at: new Date(), error: null });
      } catch (e) {
        await trx('billing_effects').where({ id: row.id }).update({ error: (e as Error).message });
        logger.error('Billing effect failed; will retry', { effectId: row.id, error: (e as Error).message });
      }
    });
  }
}
