/**
 * Regression test for issue #148.
 *
 * The `verifyEmrWebhook` guard added by #105/#115 was mounted on
 * POST /api/reviews/webhook — an endpoint whose handler matched clients on
 * `locations.id`, a value EMR never sends, so it silently dropped every payload.
 *
 * Meanwhile POST /webhooks/emr — the endpoint EMR actually reaches, and the one
 * with the correct `emr_organization_id` lookup — had no auth middleware at all.
 * Client resolution is by a small sequential integer, so anyone who could guess
 * one could inject reviews and private feedback into a customer's account.
 *
 * The existing webhook-token tests only covered /api/reviews/webhook, which is
 * exactly why this went unnoticed: they asserted the guard worked on the path
 * that did nothing.
 */
import request from 'supertest';

const WEBHOOK_TOKEN = 'test-emr-webhook-token';

jest.mock('../config', () => {
  const actual = jest.requireActual<{ config: Record<string, unknown> }>('../config');
  return {
    config: {
      ...(actual.config as object),
      embedmyreviews: {
        ...((actual.config as { embedmyreviews?: object }).embedmyreviews ?? {}),
        webhookToken: WEBHOOK_TOKEN,
        webhookSecret: '',
      },
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const app = (require('../app') as { default: any }).default;

// organization_id that matches no client — the handler resolves nothing and
// writes nothing, so these tests assert on the AUTH boundary only.
const PAYLOAD = {
  webhook_event: 'review-created',
  organization_id: 999999,
  data: { id: 'evt-148-regression', source: 'Google', rating: 5, message: 'test' },
};

// Both URLs must behave identically. /webhooks/emr is the one that was open.
describe.each([
  ['/webhooks/emr', 'the endpoint EMR actually reaches'],
  ['/api/reviews/webhook', 'legacy URL, may still be registered in EMR'],
])('EMR webhook auth — %s (%s)', (path) => {
  it('rejects a request with no token', async () => {
    const res = await request(app)
      .post(path)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(PAYLOAD));

    expect(res.status).toBe(401);
    expect(res.body?.error?.code).toBe('INVALID_TOKEN');
  });

  it('rejects a wrong token in the query string', async () => {
    const res = await request(app)
      .post(`${path}?token=not-the-token`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(PAYLOAD));

    expect(res.status).toBe(401);
  });

  it('rejects a wrong token in the header', async () => {
    const res = await request(app)
      .post(path)
      .set('Content-Type', 'application/json')
      .set('x-webhook-token', 'not-the-token')
      .send(JSON.stringify(PAYLOAD));

    expect(res.status).toBe(401);
  });

  it('accepts the correct token in the query string', async () => {
    const res = await request(app)
      .post(`${path}?token=${WEBHOOK_TOKEN}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(PAYLOAD));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it('accepts the correct token in the header', async () => {
    const res = await request(app)
      .post(path)
      .set('Content-Type', 'application/json')
      .set('x-webhook-token', WEBHOOK_TOKEN)
      .send(JSON.stringify(PAYLOAD));

    expect(res.status).toBe(200);
  });
});
