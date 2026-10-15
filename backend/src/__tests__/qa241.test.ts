import request from 'supertest';
import app from '../app';
import { db } from '../db/connection';
import { config } from '../config';
import { stripe, handleWebhookEvent } from '../services/stripe.service';
import { webhook } from '../controllers/billing.controller';
describe('QA 241 regression paths', () => {
let userId: string, clientId: string, locationId: string, token: string;
beforeAll(async () => {
  await db('stripe_webhook_events').whereLike('id', 'evt_241_%').delete();
  const email = `archive-${Date.now()}@example.invalid`;
  await request(app).post('/api/auth/register').send({ email, password: 'Password123!', businessName: 'Archive QA' });
  const u = await db('users').where({email}).first(); userId=u.id;
  clientId=(await db('clients').where({user_id:userId}).first()).id;
  token=(await request(app).post('/api/auth/login').send({email,password:'Password123!'})).body.data.accessToken;
  locationId=(await db('locations').insert({client_id:clientId,name:'Archived branch'}).returning('id'))[0].id;
});
afterAll(async()=>{await db('users').where({id:userId}).delete();await db('stripe_webhook_events').whereLike('id','evt_241_%').delete();});
it('archives without cascading away keywords and excludes archived locations from active APIs',async()=>{
  await db('keywords').insert({location_id:locationId,keyword:'archived keyword'});
  await db('active_locations').where({id:locationId}).update({archived_at:new Date()});
  expect(await db('locations').where({id:locationId}).first()).toBeTruthy();
  expect(await db('keywords').where({location_id:locationId})).toHaveLength(1);
  const r=await request(app).get('/api/locations').set('Authorization',`Bearer ${token}`);expect(r.body.data).toEqual([]);
  const k=await request(app).post('/api/keywords').set('Authorization',`Bearer ${token}`).send({locationId,keyword:'new'});expect(k.status).toBe(404);
});
it('requires an authenticated reviewed checkout before activation',async()=>{
  const r=await request(app).post('/api/billing/subscription-intent').set('Authorization',`Bearer ${token}`).send({plan:'pro'});expect(r.status).toBe(409);
});
it('deduplicates verified events and returns retryable processing errors',async()=>{
  const prior=config.stripe.webhookSecret;Object.assign(config.stripe, {webhookSecret:'qa'});
  (stripe as any).webhooks={constructEvent:jest.fn().mockReturnValue({id:'evt_241_once',type:'qa'})};
  const handler=handleWebhookEvent as jest.Mock;handler.mockResolvedValue(undefined);
  const req={headers:{'stripe-signature':'qa'},body:Buffer.from('{}')} as any;
  const res={status:jest.fn().mockReturnThis(),json:jest.fn()} as any;
  try {
    handler.mockClear();await webhook(req,res,jest.fn());await webhook(req,res,jest.fn());expect(handler).toHaveBeenCalledTimes(1);
    (stripe.webhooks.constructEvent as jest.Mock).mockReturnValue({id:'evt_241_retry',type:'qa'});handler.mockRejectedValueOnce(new Error('transient'));await webhook(req,res,jest.fn());expect(res.status).toHaveBeenLastCalledWith(500);
    expect(await db('stripe_webhook_events').where({id:'evt_241_retry'}).first()).toBeUndefined();
    await webhook(req,res,jest.fn());expect(await db('stripe_webhook_events').where({id:'evt_241_retry'}).first()).toBeTruthy();
    Object.assign(config.stripe, {webhookSecret:''});await webhook(req,res,jest.fn());expect(res.status).toHaveBeenLastCalledWith(503);
  } finally {Object.assign(config.stripe, {webhookSecret:prior});}
});

});
