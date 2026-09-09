const mockRetrieve = jest.fn();
const mockUpdate = jest.fn().mockResolvedValue(1);
const mockWhere = jest.fn(() => ({ update: mockUpdate }));
jest.mock('stripe', () => ({ __esModule: true, default: jest.fn(() => ({ subscriptions: { retrieve: mockRetrieve } })) }));
jest.mock('../../db/connection', () => ({ db: jest.fn(() => ({ where: mockWhere })) }));
jest.mock('../../services/email.service', () => ({ sendPaymentFailedEmail: jest.fn() }));
jest.mock('../../services/emr_provisioning', () => ({ deprovisionClient: jest.fn() }));
import { handleWebhookEvent } from '../../services/stripe.service';
import Stripe from 'stripe';

function paid(type = 'invoice.payment_succeeded'): Stripe.Event {
  return { id: 'evt_qa', type, data: { object: { id: 'in_paid', subscription: 'sub_qa' } } } as unknown as Stripe.Event;
}
function subscription(status = 'active', latest_invoice: unknown = 'in_paid') {
  return { id: 'sub_qa', status, latest_invoice, metadata: { plan: 'pro' }, items: { data: [] } };
}
beforeEach(() => { jest.clearAllMocks(); mockRetrieve.mockReset(); });
describe('paid invoice event ordering', () => {
  it.each(['canceled', 'past_due', 'unpaid', 'incomplete_expired', 'paused'])('does not grant access when Stripe currently reports %s', async status => {
    mockRetrieve.mockResolvedValue(subscription(status));
    await handleWebhookEvent(paid());
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it('does not use an older paid invoice to grant a newer upgrade', async () => {
    mockRetrieve.mockResolvedValue(subscription('active', 'in_newer_unpaid_upgrade'));
    await handleWebhookEvent(paid());
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it.each(['invoice.payment_succeeded', 'invoice.paid'])('grants the paid plan for the current active invoice (%s)', async type => {
    mockRetrieve.mockResolvedValue(subscription('active', { id: 'in_paid' }));
    await handleWebhookEvent(paid(type));
    expect(mockWhere).toHaveBeenCalledWith({ stripe_subscription_id: 'sub_qa' });
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ subscription_status: 'active', product_line: 'pro', payment_failed_at: null, locations_limit: 1 }));
  });
  it('propagates provider failure for retry without granting access', async () => {
    mockRetrieve.mockRejectedValue(new Error('Stripe temporarily unavailable'));
    await expect(handleWebhookEvent(paid())).rejects.toThrow('Stripe temporarily unavailable');
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
