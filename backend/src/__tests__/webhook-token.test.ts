/**
 * Webhook shared-token auth regression tests.
 * EMR exposes no signing secret, so the reviews webhook is authenticated by a shared
 * token carried in the URL (?token=) or an X-Webhook-Token header. Verifies the endpoint
 * rejects missing/wrong tokens and accepts the correct one via either transport.
 */
import request from 'supertest';

const WEBHOOK_TOKEN = 'test-webhook-token-abc123';

// Mock config before app is loaded so the webhook token (and no HMAC secret) is active.
jest.mock('../config', () => {
  const actual = jest.requireActual<{ config: Record<string, unknown> }>('../config');
  return {
    config: {
      ...(actual.config as object),
      embedmyreviews: { webhookToken: WEBHOOK_TOKEN },
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const app = (require('../app') as { default: any }).default;

describe('POST /api/reviews/webhook — shared-token security', () => {
  const payload = { id: 'rev_123', platform: 'google', event: 'ReviewCreated', author_name: 'Test', rating: 5 };

  it('rejects requests with no token', async () => {
    const res = await request(app).post('/api/reviews/webhook').send(payload);
    expect(res.status).toBe(401);
  });

  it('rejects requests with a wrong token (query param)', async () => {
    const res = await request(app)
      .post('/api/reviews/webhook?token=not-the-token')
      .send(payload);
    expect(res.status).toBe(401);
  });

  it('rejects requests with a wrong token (header)', async () => {
    const res = await request(app)
      .post('/api/reviews/webhook')
      .set('x-webhook-token', 'not-the-token')
      .send(payload);
    expect(res.status).toBe(401);
  });

  it('accepts the correct token via query param', async () => {
    const res = await request(app)
      .post(`/api/reviews/webhook?token=${WEBHOOK_TOKEN}`)
      .send(payload);
    // 200 = accepted (even if location not found — graceful accept)
    expect(res.status).toBe(200);
  });

  it('accepts the correct token via X-Webhook-Token header', async () => {
    const res = await request(app)
      .post('/api/reviews/webhook')
      .set('x-webhook-token', WEBHOOK_TOKEN)
      .send(payload);
    expect(res.status).toBe(200);
  });
});
