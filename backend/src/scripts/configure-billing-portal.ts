import Stripe from 'stripe';
import { config } from '../config';

async function main() {
  const stripe = new Stripe(config.stripe.secretKey);
  const prices = await Promise.all([stripe.prices.retrieve(config.stripe.prices.liteBase), stripe.prices.retrieve(config.stripe.prices.base)]);
  const products = prices.map(p => ({ product: typeof p.product === 'string' ? p.product : p.product.id, prices: [p.id] }));
  const configs = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
  const current = configs.data[0];
  if (!current) throw new Error('No default portal configuration found; create the account default first.');
  const features = { subscription_update: { enabled: true, default_allowed_updates: ['price', 'promotion_code'] as Array<'price' | 'promotion_code'>, products, proration_behavior: 'always_invoice' as const } };
  if (process.argv.includes('--apply')) {
    const saved = await stripe.billingPortal.configurations.update(current.id, { features });
    console.log(JSON.stringify({ id: saved.id, live: saved.livemode, switchingEnabled: saved.features.subscription_update.enabled,
      cancellationEnabled: saved.features.subscription_cancel.enabled, products: saved.features.subscription_update.products }));
  } else {
    console.log(JSON.stringify({ id: current.id, live: current.livemode, currentSwitching: current.features.subscription_update.enabled, requestedFeatures: features }));
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
