/**
 * Release rehearsal: run only inside slseo-test-api after rebuilding the test stack.
 * docker cp scripts/verify-billing-http.cjs slseo-test-api:/tmp/billing-http.cjs
 * docker exec slseo-test-api node /tmp/billing-http.cjs
 *
 * Uses real Stripe sandbox subscriptions/invoices and test cards, then signs
 * representative webhook payloads and delivers them over HTTP to the isolated API.
 * This does NOT verify Stripe-hosted endpoint delivery or the browser PaymentElement.
 * Email is constrained to the test placeholder provider key. Created Stripe objects
 * and the unique test account are cleaned up in finally; cleanup failures are printed.
 */
const assert=require('assert/strict');
const {db}=require('/app/dist/db/connection');
const {stripe}=require('/app/dist/services/stripe.service');
const {config}=require('/app/dist/config');
const API='http://localhost:3000/api';
let token,userId,customerId;const subs=[];let checks=0;
function pass(label){checks++;console.log('PASS '+label)}
async function request(path,body,expected=200){const res=await fetch(API+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});const data=await res.json();assert.equal(res.status,expected,`${path}: ${res.status} ${JSON.stringify(data)}`);return data;}
async function event(type,object,valid=true){const payload=JSON.stringify({id:'evt_release_'+Date.now(),object:'event',livemode:false,type,data:{object}});const signature=stripe.webhooks.generateTestHeaderString({payload,secret:valid?config.stripe.webhookSecret:'whsec_invalid'});const res=await fetch(API+'/billing/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':signature},body:payload});assert.equal(res.status,valid?200:400,await res.text());}
async function client(){return db('clients').where({user_id:userId}).first()}
async function latest(subId){return stripe.subscriptions.retrieve(subId,{expand:['latest_invoice.payment_intent']})}
async function paid(subId){const sub=await latest(subId);await event('invoice.payment_succeeded',sub.latest_invoice);return sub.latest_invoice;}
(async()=>{
 assert.equal(process.env.NODE_ENV,'test');assert(config.db.url.includes('superlocalseo_test'));assert(config.stripe.secretKey.startsWith('sk_test_'));assert(config.stripe.webhookSecret);assert.equal(process.env.RESEND_API_KEY,'re_test_placeholder');
 const email='release-billing-'+Date.now()+'@example.invalid';
 const registration=await request('/auth/register',{email,password:'ReleaseTest123!',businessName:'Release billing fixture'},201);
 const user=await db('users').where({email}).first();assert(user);userId=user.id;await db('users').where({id:userId}).update({email_verified:true});
 token=(await request('/auth/login',{email,password:'ReleaseTest123!'})).data.accessToken;assert(token);pass('registration and login through HTTP');
 let intent=(await request('/billing/subscription-intent',{plan:'lite',extraLocations:0})).data;assert(intent.subscriptionId);subs.push(intent.subscriptionId);
 let sub=await latest(intent.subscriptionId);customerId=sub.customer;assert.equal(sub.livemode,false);assert.equal(sub.items.data[0].price.unit_amount,14900);assert.equal(sub.items.data.length,1);pass('Lite checkout creates test-mode $149 subscription without setup fee');
 const switched=(await request('/billing/subscription-intent',{plan:'pro',extraLocations:0})).data;subs.push(switched.subscriptionId);
 assert(['canceled','incomplete_expired'].includes((await stripe.subscriptions.retrieve(intent.subscriptionId)).status));
 intent=(await request('/billing/subscription-intent',{plan:'lite',extraLocations:0})).data;subs.push(intent.subscriptionId);
 assert(['canceled','incomplete_expired'].includes((await stripe.subscriptions.retrieve(switched.subscriptionId)).status));sub=await latest(intent.subscriptionId);assert.equal(sub.items.data[0].price.unit_amount,14900);pass('switching checkout plans cancels superseded unpaid subscriptions');
 const concurrent=await Promise.all([request('/billing/subscription-intent',{plan:'lite',extraLocations:0}),request('/billing/subscription-intent',{plan:'lite',extraLocations:0})]);
 const concurrentIds=concurrent.map(r=>r.data.subscriptionId);subs.push(...concurrentIds);sub=await latest((await client()).stripe_subscription_id);
 assert(concurrentIds.includes(sub.id));for(const id of [intent.subscriptionId,...concurrentIds].filter(id=>id!==sub.id))assert(['canceled','incomplete_expired'].includes((await stripe.subscriptions.retrieve(id)).status));pass('concurrent checkout requests leave only the current intent payable');
 await stripe.paymentIntents.confirm(sub.latest_invoice.payment_intent.id,{payment_method:'pm_card_visa'});
 await paid(sub.id);assert.equal((await client()).product_line,'lite');assert.equal((await client()).subscription_status,'active');pass('successful test-card payment and signed HTTP webhook activate Lite');
 await request('/billing/subscription-intent',{plan:'lite',extraLocations:0},409);pass('active subscriber cannot create a duplicate subscription');
 await event('invoice.payment_failed',sub.latest_invoice,false);assert.equal((await client()).subscription_status,'active');pass('invalid webhook signature rejected without changing access');
 const upgrade=(await request('/billing/upgrade',{})).data;assert(upgrade.invoiceId);assert.equal((await client()).product_line,'lite');
 sub=await latest(sub.id);assert(sub.items.data.some(i=>i.price.id===config.stripe.prices.base));assert(!sub.items.data.some(i=>i.price.id===config.stripe.prices.liteBase));pass('Lite-to-Pro upgrade waits for payment event before granting Pro');
 if(upgrade.clientSecret){const id=upgrade.clientSecret.split('_secret')[0];const pi=await stripe.paymentIntents.retrieve(id);if(pi.status!=='succeeded')await stripe.paymentIntents.confirm(id,{payment_method:'pm_card_visa'});}
 let upgradeInvoice=await stripe.invoices.retrieve(upgrade.invoiceId);if(upgradeInvoice.status==='open')await stripe.invoices.pay(upgradeInvoice.id,{payment_method:'pm_card_visa'});
 const oldPaid=await paid(sub.id);assert.equal((await client()).product_line,'pro');pass('paid upgrade webhook grants Pro');
 await event('invoice.payment_succeeded',oldPaid);assert.equal((await client()).product_line,'pro');pass('duplicate successful invoice event is harmless');
 const deleted=await stripe.subscriptions.cancel(sub.id);await event('customer.subscription.deleted',deleted);assert.equal((await client()).subscription_status,'canceled');await request('/reviews',undefined,402);pass('cancellation webhook blocks protected customer API');
 await event('invoice.payment_succeeded',oldPaid);assert.equal((await client()).subscription_status,'canceled');await request('/reviews',undefined,402);pass('delayed paid invoice cannot reactivate canceled access');
 await request('/billing/status');pass('billing remains accessible after cancellation');
 const retry=(await request('/billing/subscription-intent',{plan:'lite',extraLocations:0})).data;subs.push(retry.subscriptionId);sub=await latest(retry.subscriptionId);
 let declined=false;try{await stripe.paymentIntents.confirm(sub.latest_invoice.payment_intent.id,{payment_method:'pm_card_chargeDeclined'})}catch(e){assert.equal(e.code,'card_declined');declined=true;}assert(declined);pass('Stripe test card decline is reproduced');
 sub=await latest(sub.id);await event('invoice.payment_failed',sub.latest_invoice);assert.equal((await client()).subscription_status,'past_due');assert((await client()).payment_failed_at);pass('failed-payment HTTP webhook records payment failure');
 await db('clients').where({user_id:userId}).update({payment_failed_at:new Date(Date.now()-4*86400000)});await request('/reviews',undefined,402);await request('/billing/status');pass('overdue account is blocked after grace period while billing stays available');
 await stripe.paymentIntents.confirm(sub.latest_invoice.payment_intent.id,{payment_method:'pm_card_visa'});await paid(sub.id);assert.equal((await client()).subscription_status,'active');assert.equal((await client()).payment_failed_at,null);pass('successful retry restores access and clears failed-payment marker');
 await event('invoice.payment_failed',sub.latest_invoice);assert.equal((await client()).subscription_status,'active');pass('delayed failure event cannot revoke recovered access');
 console.log(JSON.stringify({checks,scope:'Stripe sandbox plus signed HTTP webhooks into isolated test app',productionWrites:0,customerMessages:0}));
})().catch(e=>{console.error('FAIL',e.message);process.exitCode=1}).finally(async()=>{for(const id of subs){try{const s=await stripe.subscriptions.retrieve(id);if(!['canceled','incomplete_expired'].includes(s.status))await stripe.subscriptions.cancel(id)}catch(e){console.error('Cleanup subscription:',e.message)}}if(customerId)await stripe.customers.del(customerId).catch(e=>console.error('Cleanup customer:',e.message));if(userId)await db('users').where({id:userId}).del();await db.destroy();});
