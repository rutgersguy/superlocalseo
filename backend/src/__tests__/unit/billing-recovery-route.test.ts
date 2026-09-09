const mockClient: Record<string, unknown> = { id: 'qa-client', user_id: 'qa-user' };
jest.mock('../../db/connection', () => ({ db: jest.fn(() => ({ where: jest.fn(() => ({ first: jest.fn(async () => mockClient) })) })) }));
jest.mock('../../middleware/auth', () => ({ requireAuth: jest.fn((_req, _res, next) => next()) }));
import { requireClient } from '../../middleware/requireClient';
import { Request, Response } from 'express';

async function access(url: string, status: string) {
  mockClient.subscription_status = status;
  mockClient.trial_ends_at = new Date(Date.now() - 86400000);
  mockClient.payment_failed_at = new Date(Date.now() - 4 * 86400000);
  const req = { originalUrl: url, path: '/status', baseUrl: '/api/billing', userId: 'qa-user' } as Request;
  const res = { headersSent: false, status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  await requireClient(req, res as unknown as Response, next);
  return { res, next };
}
describe('billing recovery remains accessible inside mounted routers', () => {
  it.each(['canceled', 'past_due', 'trialing'])('allows billing status for %s accounts', async status => {
    const { res, next } = await access('/api/billing/status?refresh=1', status);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
  it.each(['/api/reviews', '/api/billing-spoof/status'])('still blocks canceled access to %s', async url => {
    const { res, next } = await access(url, 'canceled');
    expect(res.status).toHaveBeenCalledWith(402);
    expect(next).not.toHaveBeenCalled();
  });
});
