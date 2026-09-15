jest.mock('../../db/connection', () => ({ db: jest.fn() }));
jest.mock('../../services/provider_routing', () => ({ providerRoutes: jest.fn() }));
jest.mock('../../services/campaign_invitations', () => ({ dispatchInvitations: jest.fn() }));
jest.mock('../../services/emr_provisioning', () => ({ getClientEMRKey: jest.fn() }));
import { db } from '../../db/connection';
import { providerRoutes } from '../../services/provider_routing';
import { list } from '../../controllers/campaign.controller';

const query = (value: any) => {
  const q: any = {};
  q.where = jest.fn((value: unknown) => { if (typeof value === 'function') value(q); return q; }); q.whereIn = jest.fn(() => q); q.orWhereNull = jest.fn(() => q);
  q.first = jest.fn().mockResolvedValue(value); q.orderBy = jest.fn().mockResolvedValue(value);
  return q;
};
const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
beforeEach(() => jest.resetAllMocks());
it('returns an explicit connection setup state without reading cached campaigns for an unprovisioned client', async () => {
  (db as unknown as jest.Mock).mockImplementation((table: string) => query(table === 'clients' ? { id: 'client' } : undefined));
  const response = res(), next = jest.fn();
  await list({ clientId: 'client', query: {} } as any, response as any, next);
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ campaigns: [], setupState: 'connection_required' }) }));
  expect(db).not.toHaveBeenCalledWith('emr_campaigns');
  expect(providerRoutes).not.toHaveBeenCalled();
  expect(next).not.toHaveBeenCalled();
});
it('keeps invalid mapped-account routing errors visible instead of turning them into setup', async () => {
  (db as unknown as jest.Mock).mockReturnValue(query({ emr_organization_id: 1, emr_location_id: 2 }));
  const failure = Object.assign(new Error('Provider routing conflicts with another customer.'), { status: 409 });
  (providerRoutes as jest.Mock).mockRejectedValue(failure);
  const response = res(), next = jest.fn();
  await list({ clientId: 'client', query: {} } as any, response as any, next);
  expect(next).toHaveBeenCalledWith(failure);
  expect(response.json).not.toHaveBeenCalled();
  expect(db).not.toHaveBeenCalledWith('emr_campaigns');
});
it('filters campaign reads to the customer and verified provider organizations', async () => {
  const campaigns = query([]);
  (db as unknown as jest.Mock).mockImplementation((table: string) => table === 'emr_campaigns' ? campaigns : query({ emr_organization_id: 1, emr_location_id: 2 }));
  (providerRoutes as jest.Mock).mockResolvedValue([{ organizationId: '1' }]);
  const response = res();
  await list({ clientId: 'client', query: {} } as any, response as any, jest.fn());
  expect(campaigns.where).toHaveBeenCalledWith({ client_id: 'client' });
  expect(campaigns.whereIn).toHaveBeenCalledWith('emr_organization_id', ['1']);
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ setupState: 'campaign_setup_required' }) }));
});
