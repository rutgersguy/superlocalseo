const mockCreate = jest.fn();
jest.mock('stripe', () => ({ __esModule: true, default: jest.fn(() => ({ subscriptions: { create: mockCreate } })) }));
jest.mock('../../db/connection', () => ({ db: jest.fn() }));
jest.mock('../../services/email.service', () => ({ sendPaymentFailedEmail: jest.fn() }));
jest.mock('../../services/emr_provisioning', () => ({ deprovisionClient: jest.fn() }));
import { createSubscriptionIntent } from '../../services/stripe.service';

beforeEach(() => jest.clearAllMocks());
describe.each(['lite', 'pro'] as const)('%s checkout', plan => {
  const subscription = (invoice: object, status = 'active') => ({
    id: 'sub_qa', status, current_period_end: 1800000000, latest_invoice: invoice,
  });
  it('completes a paid zero-dollar invoice without a PaymentIntent', async () => {
    mockCreate.mockResolvedValue(subscription({ paid: true, status: 'paid', amount_due: 0, payment_intent: null }));
    await expect(createSubscriptionIntent('cus_qa', 0, 'qa', 'promo_free', plan)).resolves.toMatchObject({
      subscriptionId: 'sub_qa', clientSecret: null, paymentRequired: false, currentPeriodEnd: 1800000000,
    });
  });
  it('preserves payment confirmation for a normal paid plan', async () => {
    mockCreate.mockResolvedValue(subscription({ paid: false, status: 'open', amount_due: 14900, payment_intent: { client_secret: 'pi_secret' } }, 'incomplete'));
    await expect(createSubscriptionIntent('cus_qa', 0, 'qa', undefined, plan)).resolves.toMatchObject({
      clientSecret: 'pi_secret', paymentRequired: true,
    });
  });
  it.each([
    { paid: false, status: 'open', amount_due: 0, payment_intent: null },
    { paid: false, status: 'open', amount_due: 14900, payment_intent: null },
  ])('never treats a missing payment intent as proof of payment (%j)', async invoice => {
    mockCreate.mockResolvedValue(subscription(invoice));
    await expect(createSubscriptionIntent('cus_qa', 0, 'qa', undefined, plan)).rejects.toThrow('Subscription requires payment but no payment confirmation is available');
  });
  it('does not activate an incomplete subscription with a zero invoice', async () => {
    mockCreate.mockResolvedValue(subscription({ paid: true, status: 'paid', amount_due: 0, payment_intent: null }, 'incomplete'));
    await expect(createSubscriptionIntent('cus_qa', 0, 'qa', undefined, plan)).rejects.toThrow('Subscription requires payment but no payment confirmation is available');
  });
});
