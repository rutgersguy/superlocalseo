import { catalog } from '../config/plans';
import { db } from '../db/connection';
import { planFor } from '../config/plans';
export type UsageMetric = 'gridScans' | 'reviewRequests' | 'aiChecks' | 'rankingRuns' | 'competitorChecks' | 'citationScans' | 'websiteAudits' | 'keywordDiscoveries';
export function limitError(message: string) { return Object.assign(new Error(message), { status: 409, code: 'PLAN_LIMIT' }); }
/** Reserve BEFORE a provider call. Ambiguous failures still consume budget: retries must never buy unbounded work. */
export async function reserveUsage(clientId: string, scope: string, metric: UsageMetric, amount = 1) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Invalid usage reservation');
  return db.transaction(async trx => {
    const client = await trx('clients').where({ id: clientId }).forUpdate().first();
    if (!client) throw limitError('Account not found.');
    if (client.pricing_version !== catalog.version) return; // legacy account behavior is unchanged
    if (client.subscription_status !== 'active' && !(client.subscription_status === 'trialing' && new Date(client.trial_ends_at).getTime() > Date.now())) throw limitError('Choose a paid plan to continue scanning.');
    const limit = metric === 'competitorChecks' ? planFor(client).competitors * (client.locations_limit ?? 1) * 35 : planFor(client)[metric];
    const period = new Date().toISOString().slice(0, 7);
    const key = { client_id: clientId, scope, metric, period };
    const row = await trx('plan_usage').where(key).first();
    if (Number(row?.used ?? 0) + amount > limit) throw limitError(`Your ${planFor(client).name} plan includes ${limit} ${metric.replace(/([A-Z])/g, ' $1').toLowerCase()} per location each calendar month. Your allowance resets next month; upgrade for a higher limit.`);
    await trx('plan_usage').insert({ ...key, used: amount }).onConflict(['client_id', 'scope', 'metric', 'period']).merge({ used: Number(row?.used ?? 0) + amount });
  });
}

export async function assertResourcesMutable(executor: typeof db, clientId: string) {
  const pending = await executor('billing_changes').where({ client_id: clientId }).whereIn('status', ['confirming', 'payment_required']).first();
  if (pending) throw limitError('Finish the pending billing change before adding keywords, competitors or team members.');
}
