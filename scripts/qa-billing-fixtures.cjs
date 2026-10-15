const { db } = require('/app/dist/db/connection');
const c = require('/app/dist/config').config;
const Stripe = require('stripe');
const s = new Stripe(c.stripe.secretKey);
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const assert = require('assert/strict');
const mode = process.argv[2];
const tag = 'sls239-20261015';
(async () => {
    assert(c.stripe.secretKey.startsWith('sk_test_'), 'Test mode required');
    if (mode === 'cleanup') {
        const tagged = await s.customers.search({ query: "metadata['qa']:'sls239-20261015'", limit: 100 });
        for (const customer of tagged.data) {
            const u = await db('users').where({ stripe_customer_id: customer.id }).first();
            if (!u)
                await s.customers.del(customer.id);
        }
    }
    if (mode === 'create') {
        assert.equal((await db('users').where('email', 'like', `${tag}-%@example.invalid`)).length, 0);
        const initial = await s.coupons.create({ percent_off: 100, duration: 'once', name: '239 initial fixture' });
        const coupon = await s.coupons.create({ percent_off: 100, duration: 'once', name: '239 upgrade QA' });
        const promo = await s.promotionCodes.create({ coupon: coupon.id, code: `QA239FREE${Date.now()}` });
        const result = [];
        for (const scenario of ['card', 'promo', 'nocard', 'decline', 'location']) {
            const password = crypto.randomBytes(16).toString('hex');
            const email = `${tag}-${scenario}@example.invalid`;
            const [u] = await db('users').insert({ email, password_hash: await bcrypt.hash(password, 10), role: 'client', email_verified: true }).returning('*');
            const customer = await s.customers.create({ metadata: { qa: tag, userId: u.id } });
            await db('users').where({ id: u.id }).update({ stripe_customer_id: customer.id });
            const plan = scenario === 'location' ? 'pro' : 'lite';
            let pm;
            if (['card', 'location', 'decline'].includes(scenario))
                pm = await s.paymentMethods.attach(scenario === 'decline' ? 'pm_card_chargeCustomerFail' : 'pm_card_visa', { customer: customer.id });
            const sub = await s.subscriptions.create({ customer: customer.id, items: [{ price: plan === 'lite' ? c.stripe.prices.liteBase : c.stripe.prices.base }], ...(pm ? { default_payment_method: pm.id } : {}), ...(['promo', 'nocard', 'decline'].includes(scenario) ? { coupon: initial.id } : {}), metadata: { userId: u.id, plan } });
            await db('users').where({ id: u.id }).update({ stripe_customer_id: customer.id });
            const [client] = await db('clients').insert({ user_id: u.id, business_name: `QA 239 ${scenario}`, stripe_subscription_id: sub.id, subscription_status: 'active', product_line: plan, locations_limit: 1, onboarding_step: 5, trial_ends_at: new Date(Date.now() + 86400000 * 7), subscription_current_period_end: new Date(sub.current_period_end * 1000) }).returning('*');
            await db('locations').insert({ client_id: client.id, name: `QA 239 ${scenario}`, is_primary: true });
            result.push({ email, password, scenario, subscriptionId: sub.id, customerId: customer.id, promo: promo.code, initialCoupon: initial.id, coupon: coupon.id, promotionId: promo.id });
        }
        console.log(JSON.stringify(result));
    }
    else if (mode === 'verify' || mode === 'cleanup') {
        for (const u of await db('users').where('email', 'like', `${tag}-%@example.invalid`)) {
            const subs = u.stripe_customer_id ? (await s.subscriptions.list({ customer: u.stripe_customer_id, status: 'all', limit: 100 })).data : [];
            const client = await db('clients').where({ user_id: u.id }).first();
            if (mode === 'verify') {
                assert.equal(subs.length, 1);
                const sub = subs[0];
                const invoices = (await s.invoices.list({ subscription: sub.id, limit: 20 })).data;
                console.log(JSON.stringify({ scenario: u.email.split('@')[0].split('-').pop(), subscriptionCount: subs.length, appPlan: client.product_line, status: client.subscription_status, slots: client.locations_limit, pending: !!sub.pending_update, invoices: invoices.map(i => ({ status: i.status, due: i.amount_due, paid: i.amount_paid })) }));
            }
            else {
                if (u.stripe_customer_id)
                    await s.customers.del(u.stripe_customer_id);
                await db('users').where({ id: u.id }).del();
                console.log(JSON.stringify({ deleted: u.email }));
            }
        }
    }
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.destroy());
