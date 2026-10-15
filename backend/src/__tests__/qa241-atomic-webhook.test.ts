import request from 'supertest';
import app from '../app';
import { db } from '../db/connection';
import { config } from '../config';
jest.unmock('../services/stripe.service');
jest.mock('../services/email.service', () => ({ sendPaymentFailedEmail: jest.fn(), sendWelcomeEmail: jest.fn(), sendVerificationEmail: jest.fn() }));
import { stripe } from '../services/stripe.service';
import { webhook } from '../controllers/billing.controller';
import { processBillingEffects } from '../services/billing-effects';
import { sendPaymentFailedEmail } from '../services/email.service';
describe('atomic webhook receipt and durable notifications',()=>{
 let userId:string,clientId:string; const event={id:'evt_241_atomic',type:'invoice.payment_failed',data:{object:{id:'in_241_atomic',subscription:'sub_241_atomic'}}};
 const req={body:Buffer.from('{}'),headers:{'stripe-signature':'test'}} as any;
 const res={status:jest.fn().mockReturnThis(),json:jest.fn()} as any;
 const prior=config.stripe.webhookSecret;
 beforeAll(async()=>{
  const [u]=await db('users').insert({email:`atomic-${Date.now()}@example.invalid`,password_hash:'unused',role:'client'}).returning('*');userId=u.id;
  const [c]=await db('clients').insert({user_id:u.id,business_name:'Atomic QA',stripe_subscription_id:'sub_241_atomic',subscription_status:'trialing'}).returning('*');clientId=c.id;
  Object.assign(config.stripe,{webhookSecret:'test'});
  jest.spyOn(stripe.webhooks,'constructEvent').mockReturnValue(event as any);
  jest.spyOn(stripe.subscriptions,'retrieve').mockResolvedValue({id:'sub_241_atomic',latest_invoice:'in_241_atomic',status:'past_due'} as any);
  jest.spyOn(stripe.invoices,'retrieve').mockResolvedValue({id:'in_241_atomic',status:'open',paid:false} as any);
 });
 afterAll(async()=>{
  await db.raw('DROP TRIGGER IF EXISTS qa241_receipt_failure ON stripe_webhook_events');
  await db.raw('DROP FUNCTION IF EXISTS qa241_receipt_failure()');
  await db('billing_effects').where({id:'payment-failed:in_241_atomic'}).delete();
  await db('stripe_webhook_events').where({id:event.id}).delete();
  await db('users').where({id:userId}).delete(); Object.assign(config.stripe,{webhookSecret:prior});jest.restoreAllMocks();
 });
 it('rolls back client effects and queued email if event receipt insertion fails',async()=>{
  await db.raw("CREATE FUNCTION qa241_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = 'evt_241_atomic' THEN RAISE EXCEPTION 'injected receipt failure'; END IF; RETURN NEW; END $$");
  await db.raw('CREATE TRIGGER qa241_receipt_failure BEFORE INSERT ON stripe_webhook_events FOR EACH ROW EXECUTE FUNCTION qa241_receipt_failure()');
  await webhook(req,res,jest.fn());expect(res.status).toHaveBeenLastCalledWith(500);
  expect((await db('clients').where({id:clientId}).first()).subscription_status).toBe('trialing');
  expect(await db('billing_effects').where({id:'payment-failed:in_241_atomic'}).first()).toBeUndefined();
  expect(sendPaymentFailedEmail).not.toHaveBeenCalled();
  await db.raw('DROP TRIGGER qa241_receipt_failure ON stripe_webhook_events');
 });
 it('retries once, deduplicates delivery, and drains one email after commit',async()=>{
  await webhook(req,res,jest.fn());await webhook(req,res,jest.fn());
  expect((await db('clients').where({id:clientId}).first()).subscription_status).toBe('past_due');
  expect(await db('billing_effects').where({id:'payment-failed:in_241_atomic'})).toHaveLength(1);
  await processBillingEffects();await processBillingEffects();
  expect(sendPaymentFailedEmail).toHaveBeenCalledTimes(1);
  expect(sendPaymentFailedEmail).toHaveBeenCalledWith(expect.any(String),'Atomic QA','payment-failed:in_241_atomic');
 });
});
