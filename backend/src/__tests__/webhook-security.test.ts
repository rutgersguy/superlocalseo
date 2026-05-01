/**
 * Webhook HMAC validation regression tests.
 * Verifies that the reviews webhook rejects requests with missing or tampered signatures.
 */
import request from 'supertest';
import crypto from 'crypto';

const WEBHOOK_SECRET = 'test-webhook-secret';

// Mock config before app is loaded so the webhook secret is available
jest.mock('../config', () => {
  const actual = jest.requireActual<{ config: Record<string, unknown> }>('../config');
  return {
    config: {
      ...(actual.config as object),
      embedmyreviews: { webhookSecret: WEBHOOK_SECRET },
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const app = (require('../app') as { default: any }).default;

function sign(body: string, secret = WEBHOOK_SECRET): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

describe('POST /api/reviews/webhook — HMAC security', () => {
  const payload = { id: 'rev_123', platform: 'google', event: 'review.created', author_name: 'Test', rating: 5 };

  it('rejects requests with no signature header', async () => {
    const res = await request(app)
      .post('/api/reviews/webhook')
      .send(payload);
    expect(res.status).toBe(401);
  });

  it('rejects requests with wrong signature', async () => {
    const body = JSON.stringify(payload);
    const res = await request(app)
      .post('/api/reviews/webhook')
      .set('x-embedmyreviews-signature', 'wrong_signature_deadbeef')
      .send(payload);
    expect(res.status).toBe(401);
  });

  it('rejects requests signed with wrong secret', async () => {
    const body = JSON.stringify(payload);
    const badSig = sign(body, 'wrong-secret');
    const res = await request(app)
      .post('/api/reviews/webhook')
      .set('x-embedmyreviews-signature', badSig)
      .send(payload);
    expect(res.status).toBe(401);
  });

  it('accepts requests with valid signature', async () => {
    const body = JSON.stringify(payload);
    const sig = sign(body);
    const res = await request(app)
      .post('/api/reviews/webhook')
      .set('x-embedmyreviews-signature', sig)
      .send(payload);
    // 200 = accepted (even if location not found — graceful accept)
    expect(res.status).toBe(200);
  });
});
