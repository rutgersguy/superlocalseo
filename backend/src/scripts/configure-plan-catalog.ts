import { stripe } from '../services/stripe.service';
import { catalog, PlanKey, BillingInterval, priceLookup } from '../config/plans';
import { db } from '../db/connection';
async function main() {
  const apply = process.argv.includes('--apply');
  for (const plan of Object.keys(catalog.plans) as PlanKey[]) {
    const p = catalog.plans[plan];
    const productId = `sls_${catalog.version.replace('-', '_')}_${plan}`;
    if (apply) {
      try { await stripe.products.retrieve(productId); }
      catch (e) { if ((e as any).code !== 'resource_missing') throw e; await stripe.products.create({ id: productId, name: `SuperLocalSEO ${p.name}`, metadata: { catalogVersion: catalog.version, plan } }); }
    }
    for (const interval of ['month', 'year'] as BillingInterval[]) for (const addon of [false, true]) {
      if (addon && !p.extraMonthly) continue;
      const lookup_key = priceLookup(plan, interval, addon);
      const amount = addon ? interval === 'year' ? p.extraAnnual : p.extraMonthly : interval === 'year' ? p.annual : p.monthly;
      const existing = (await stripe.prices.list({ lookup_keys: [lookup_key], limit: 2 })).data;
      if (existing.length && (existing.length !== 1 || existing[0].unit_amount !== amount || existing[0].currency !== catalog.currency || existing[0].recurring?.interval !== interval)) throw new Error(`Conflicting price: ${lookup_key}`);
      if (!existing.length && apply) await stripe.prices.create({ product: productId, lookup_key, currency: catalog.currency, unit_amount: amount, recurring: { interval }, metadata: { catalogVersion: catalog.version, plan, kind: addon ? 'location' : 'base' } }, { idempotencyKey: lookup_key });
      console.log(JSON.stringify({ lookup_key, amount, interval, state: existing.length ? 'existing' : apply ? 'created' : 'missing' }));
    }
  }
  if (apply) {
    // Downgrades must pass through our explicit location selection. The portal
    // continues to provide payment methods, invoices and subscription cancellation.
    const configs = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
    if (configs.data[0]) await stripe.billingPortal.configurations.update(configs.data[0].id, { features: { subscription_update: { enabled: false } } });
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.destroy());
