import { processCitations } from '../jobs/citations.job';
import { scanLocation } from '../services/citation_scan.service';
jest.mock('../services/citation_scan.service', () => ({ scanLocation: jest.fn() }));
import request from 'supertest';
import app from '../app';
import { db } from '../db/connection';
import { stripe } from '../services/stripe.service';
import { confirmCbCampaign, getCbCampaign, getCbCampaignLookup } from '../services/brightlocal.service';
import { submitInitialListings, validateSubmission } from '../services/citation_submission.service';
jest.mock('../services/brightlocal.service', () => ({ confirmCbCampaign: jest.fn(), getCbCampaign: jest.fn(), getCbCampaignLookup: jest.fn() }));
const options = { packageId: 'cb10', citations: ['yelp.com'], publishers: [], detailsConfirmed: true };
const email = `listing-policy-${Date.now()}@example.com`;
let clientId: string, locationId: string, token: string;
const retrieve = jest.fn(), invoice = jest.fn();
const submit = () => submitInitialListings(clientId, locationId, 'campaign-policy', options);
describe('paid initial listing orders', () => {
beforeAll(async () => {
  Object.assign(stripe, { subscriptions: { retrieve }, invoices: { retrieve: invoice } });
  await request(app).post('/api/auth/register').send({ email, password: 'Password123!', businessName: 'Policy fixture' });
  const user = await db('users').where({ email }).first();
  clientId = (await db('clients').where({ user_id: user.id }).first()).id;
  token = (await request(app).post('/api/auth/login').send({ email, password: 'Password123!' })).body.data.accessToken;
  locationId = (await db('locations').insert({ client_id: clientId, name: 'Policy fixture', brightlocal_location_id: 123 }).returning('id'))[0].id;
});
beforeEach(async () => {
  jest.clearAllMocks();
  await db('citation_orders').where({ client_id: clientId }).delete();
  await db('citation_submissions').where({ client_id: clientId }).delete();
  await db('clients').where({ id: clientId }).update({ subscription_status: 'active', product_line: 'pro', industry: 'Personal Training', stripe_subscription_id: 'sub_policy' });
  retrieve.mockResolvedValue({ id: 'sub_policy', status: 'active', latest_invoice: 'in_policy', metadata: { plan: 'pro' } });
  invoice.mockResolvedValue({ id: 'in_policy', subscription: 'sub_policy', paid: true, status: 'paid', amount_paid: 34900, livemode: true });
  (getCbCampaign as jest.Mock).mockResolvedValue({ locationId: 123 });
  (getCbCampaignLookup as jest.Mock).mockResolvedValue({ lookupStatus: 'complete', availableCitations: ['yelp.com'] });
  (confirmCbCampaign as jest.Mock).mockResolvedValue(undefined);
});
afterAll(async () => { await db('citation_orders').where({ client_id: clientId }).delete(); await db('users').where({ email }).delete(); });
it('blocks trials at the HTTP spending boundary without calling providers', async () => {
  await db('clients').where({ id: clientId }).update({ subscription_status: 'trialing' });
  const res = await request(app).post('/api/citations/campaign/campaign-policy/confirm').set('Authorization', `Bearer ${token}`).send({ ...options, locationId });
  expect(res.status).toBe(402);
  expect(retrieve).not.toHaveBeenCalled(); expect(confirmCbCampaign).not.toHaveBeenCalled();
});
it.each([0, undefined])('blocks invoices without a positive payment (%s)', async amount_paid => {
  invoice.mockResolvedValue({ paid: true, status: 'paid', amount_paid });
  await expect(submit()).rejects.toMatchObject({ status: 402 });
  expect(confirmCbCampaign).not.toHaveBeenCalled();
});
it('rejects another location’s campaign', async () => {
  (getCbCampaign as jest.Mock).mockResolvedValue({ locationId: 999 });
  await expect(submit()).rejects.toMatchObject({ status: 403 }); expect(confirmCbCampaign).not.toHaveBeenCalled();
});
it('rejects incomplete lookup and unavailable directories', async () => {
  (getCbCampaignLookup as jest.Mock).mockResolvedValue({ lookupStatus: 'processing' });
  await expect(submit()).rejects.toMatchObject({ status: 422 });
  (getCbCampaignLookup as jest.Mock).mockResolvedValue({ lookupStatus: 'complete', availableCitations: [] });
  await expect(submit()).rejects.toMatchObject({ status: 422 }); expect(confirmCbCampaign).not.toHaveBeenCalled();
});
it('reserves a single package under concurrent requests and repeated delivery', async () => {
  const outcomes = await Promise.allSettled([submit(), submit()]);
  expect(outcomes.some(r => r.status === 'fulfilled')).toBe(true);
  expect(confirmCbCampaign).toHaveBeenCalledTimes(1);
  await submit(); expect(confirmCbCampaign).toHaveBeenCalledTimes(1);
  expect(await db('citation_orders').where({ location_id: locationId }).first()).toMatchObject({ credits_reserved: 10, status: 'submitted', invoice_id: 'in_policy' });
  await expect(submitInitialListings(clientId, locationId, 'another-campaign', options)).rejects.toMatchObject({ status: 409 });
});
it('holds the allocation after an uncertain provider outcome', async () => {
  (confirmCbCampaign as jest.Mock).mockRejectedValue(new Error('timeout after request accepted'));
  await expect(submit()).rejects.toMatchObject({ status: 409 });
  await expect(submit()).rejects.toMatchObject({ status: 409 });
  expect(confirmCbCampaign).toHaveBeenCalledTimes(1);
  expect((await db('citation_orders').where({ location_id: locationId }).first()).status).toBe('needs_review');
});
it.each([{ packageId: 'cb25' }, { publishers: ['dataaxle'] }, { autoSelect: true }, { express: true }, { removeDuplicates: true }, { detailsConfirmed: false }, { citations: ['healthgrades.com'] }, { citations: ['yelp.com', 'www.yelp.com'] }])('rejects an excluded selection %j', override => {
  expect(() => validateSubmission({ ...options, ...override }, 'Personal Training')).toThrow();
});

it('also blocks an administrator from spending for a trial customer', async () => {
  await db('users').where({ email }).update({ role: 'admin' });
  const adminToken = (await request(app).post('/api/auth/login').send({ email, password: 'Password123!' })).body.data.accessToken;
  await db('clients').where({ id: clientId }).update({ subscription_status: 'trialing' });
  const response = await request(app).post('/api/admin/citations/campaign/campaign-policy/confirm').set('Authorization', `Bearer ${adminToken}`).send({ ...options, clientId, locationId });
  expect(response.status).toBe(402); expect(confirmCbCampaign).not.toHaveBeenCalled();
  await db('users').where({ email }).update({ role: 'client' });
});

it('monthly checks exclude trials, inactive subscriptions and Lite without submitting', async () => {
  const scan = scanLocation as jest.Mock;
  scan.mockResolvedValue([{ directory: 'yelp', status: 'listed', nameMatch: true, addressMatch: true, phoneMatch: true }]);
  for (const subscription_status of ['trialing', 'canceled', 'past_due']) {
    await db('clients').where({ id: clientId }).update({ subscription_status });
    await processCitations({ name: 'monthly-scan', data: { clientId } } as any);
    expect(scan).not.toHaveBeenCalled();
  }
  await db('clients').where({ id: clientId }).update({ subscription_status: 'active', product_line: 'lite' });
  await processCitations({ name: 'monthly-scan', data: { clientId } } as any);
  expect(scan).not.toHaveBeenCalled();
  await db('clients').where({ id: clientId }).update({ product_line: 'pro' });
  await processCitations({ name: 'monthly-scan', data: { clientId } } as any);
  expect(scan).toHaveBeenCalledTimes(1);
  expect(confirmCbCampaign).not.toHaveBeenCalled();
  expect(await db('citation_orders').where({ location_id: locationId })).toHaveLength(0);
});

});
