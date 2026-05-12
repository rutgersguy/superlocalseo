# SuperLocalSEO — Testing Strategy

**Audience:** Developers adding features or fixing bugs  
**Purpose:** What to test, how to test it, and what tooling to use

---

## Philosophy

Test what can break in ways that cost money or lose data. Prioritize:
1. **Business-critical logic** — scoring, billing events, auth
2. **External integration edges** — API timeouts, bad payloads, auth failures
3. **Security boundaries** — RBAC, HMAC validation, injection prevention
4. **Data integrity** — DB constraints, dedup logic, migration correctness

Skip: trivial getters, UI snapshot tests that break on every style change, tests that only verify that Express routes forward to a function.

---

## Test Stack

| Layer | Tool | Location |
|---|---|---|
| Unit tests | **Vitest** (or Jest) | `backend/src/**/*.test.ts` |
| Integration tests | **Supertest** + real DB | `backend/tests/integration/` |
| E2E tests | **Playwright** | `e2e/` |
| API contract smoke tests | **curl / httpie scripts** | `scripts/smoke-test.sh` |
| Load testing | **k6** | `load/` |

---

## Unit Tests

Unit tests cover pure functions and service logic that can be tested without network or DB.

### Priority targets

#### 1. SEO Audit Scoring (`audit_score.service.ts`)

Test `computeOnPageScore()` against known on-page result shapes:

```typescript
describe('computeOnPageScore', () => {
  it('returns 100 when all checks pass', () => {
    const result = computeOnPageScore({ https: true, titleTag: 'Good Title', ... });
    expect(result.score).toBe(100);
  });

  it('deducts correct weights for each failing check', () => {
    const result = computeOnPageScore({ https: false, titleTag: '', ... });
    expect(result.score).toBeLessThan(100);
    expect(result.details).toContain('HTTPS: Not enabled');
  });

  it('blends Lighthouse score at 40% when present', () => {
    const onPage = { score: 80 };
    const lhScore = 60;
    const blended = Math.round(80 * 0.6 + 60 * 0.4);
    expect(blended).toBe(72);
  });
});
```

#### 2. Lighthouse Data Extraction (`dataforseo.service.ts`)

Test `extractFailingAudits()` against fixture Lighthouse JSON:

```typescript
describe('extractFailingAudits', () => {
  it('excludes informative/manual/notApplicable audits', () => {
    const audits = extractFailingAudits(fixtureCategory, fixtureAudits);
    audits.forEach(a => expect(['informative','manual','notApplicable']).not.toContain(a.scoreDisplayMode));
  });

  it('excludes passing audits (score >= 0.9)', () => {
    const audits = extractFailingAudits(fixtureCategory, fixtureAudits);
    audits.forEach(a => expect(a.score).toBeLessThan(0.9));
  });

  it('returns at most 6 audits', () => {
    const audits = extractFailingAudits(fixtureCategory, fixtureAudits);
    expect(audits.length).toBeLessThanOrEqual(6);
  });

  it('strips markdown links from descriptions', () => {
    const audits = extractFailingAudits(fixtureCategory, fixtureAudits);
    audits.forEach(a => expect(a.description).not.toMatch(/\[.*\]\(.*\)/));
  });
});
```

Store fixture JSON in `backend/tests/fixtures/lighthouse-response.json`.

#### 3. PDF Priority Action Builder (`audit_report.service.ts`)

Test `buildPriorityActions()`:

```typescript
it('caps output at 8 actions', () => {
  const actions = buildPriorityActions(manyOnPageDetails, manyLighthouseData);
  expect(actions.length).toBeLessThanOrEqual(8);
});

it('places high-priority actions before medium', () => {
  const actions = buildPriorityActions(mixedDetails, mockLhData);
  const firstMediumIdx = actions.findIndex(a => a.priority === 'medium');
  const lastHighIdx = actions.map(a => a.priority).lastIndexOf('high');
  expect(lastHighIdx).toBeLessThan(firstMediumIdx);
});
```

#### 4. Webhook HMAC Validation

Test the validation helper used by EmbedMyReviews and Stripe webhooks:

```typescript
it('accepts correct HMAC signature', () => {
  const secret = 'test-secret';
  const body = JSON.stringify({ event: 'review.created' });
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  expect(validateWebhookSignature(body, sig, secret)).toBe(true);
});

it('rejects tampered payload', () => {
  expect(validateWebhookSignature('tampered', validSig, secret)).toBe(false);
});
```

#### 5. Billing Subscription State Transitions

Test pure state transition logic (not Stripe API calls):

```typescript
it('sets status to active on invoice.paid', () => {
  const state = handleStripeEvent({ type: 'invoice.paid', ... });
  expect(state.subscriptionStatus).toBe('active');
});

it('sets status to past_due on payment_failed', () => {
  const state = handleStripeEvent({ type: 'invoice.payment_failed', ... });
  expect(state.subscriptionStatus).toBe('past_due');
});
```

#### 6. Review Sentiment Scoring

```typescript
it('classifies 5-star review as positive', () => {
  expect(classifySentiment(5, 'Amazing service!')).toBe('positive');
});

it('classifies 1-star review as negative', () => {
  expect(classifySentiment(1, 'Terrible experience')).toBe('negative');
});
```

---

## Integration Tests

Integration tests run against a real PostgreSQL database (separate test DB, not production). Use `supertest` to make HTTP requests against the Express app without a live server.

### Setup

```typescript
// tests/integration/setup.ts
import knex from '../../src/db';
import app from '../../src/app';
import request from 'supertest';

beforeAll(async () => {
  await knex.migrate.latest();
});

afterEach(async () => {
  // Truncate all tables between tests (order matters for FK constraints)
  await knex.raw('TRUNCATE users, clients, locations, keywords, ranking_snapshots, ... CASCADE');
});

afterAll(async () => {
  await knex.destroy();
});
```

### Environment for tests

```bash
# .env.test
DATABASE_URL=postgresql://slseo:slseo@localhost:5433/superlocalseo_test
REDIS_URL=redis://localhost:6399
JWT_SECRET=test-secret-not-for-production
JWT_REFRESH_SECRET=test-refresh-secret
ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000001
STRIPE_SECRET_KEY=sk_test_...
```

### Priority integration test suites

#### Auth flow

```typescript
describe('POST /api/auth/register', () => {
  it('creates user and sends verification email', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'test@example.com',
      password: 'Password123!',
      businessName: 'Test Biz',
    });
    expect(res.status).toBe(201);
    const user = await db('users').where({ email: 'test@example.com' }).first();
    expect(user).toBeDefined();
    expect(user.email_verified).toBe(false);
  });
});

describe('POST /api/auth/login', () => {
  it('returns JWT and sets refresh cookie', async () => {
    // seed user first
    const res = await request(app).post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('rejects wrong password with 401', async () => {
    const res = await request(app).post('/api/auth/login').send({ email, password: 'wrong' });
    expect(res.status).toBe(401);
  });
});
```

#### RBAC enforcement

These are high-value tests — they verify that access control actually works:

```typescript
describe('RBAC', () => {
  it('admin user can access /api/admin/users', async () => {
    const adminToken = await loginAs('admin');
    const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('client user cannot access /api/admin/users', async () => {
    const clientToken = await loginAs('client');
    const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${clientToken}`);
    expect(res.status).toBe(403);
  });

  it('staff team member cannot invite other staff', async () => {
    // staff = same permissions as client except cannot invite/remove staff
    const staffToken = await loginAsTeamMember('staff');
    const res = await request(app).post('/api/team/invite').set('Authorization', `Bearer ${staffToken}`)
      .send({ email: 'newstaff@example.com', role: 'staff' });
    expect(res.status).toBe(403);
  });

  it('staff can access rankings data', async () => {
    const staffToken = await loginAsTeamMember('staff');
    const res = await request(app).get('/api/rankings').set('Authorization', `Bearer ${staffToken}`);
    expect(res.status).toBe(200);
  });
});
```

#### Subscription gating

```typescript
describe('requireActiveSubscription', () => {
  it('blocks requests when subscription is canceled', async () => {
    const token = await loginAsClientWithStatus('canceled');
    const res = await request(app).get('/api/rankings').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(402);
  });

  it('allows requests when subscription is active', async () => {
    const token = await loginAsClientWithStatus('active');
    const res = await request(app).get('/api/rankings').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
```

#### Webhook security

```typescript
describe('POST /api/reviews/webhook', () => {
  it('accepts payload with valid HMAC', async () => {
    const body = JSON.stringify({ event: 'review.created', data: { ... } });
    const sig = generateHmac(body, process.env.EMBEDMYREVIEWS_WEBHOOK_SECRET);
    const res = await request(app).post('/api/reviews/webhook')
      .set('x-emr-signature', sig)
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(200);
  });

  it('rejects payload with invalid HMAC', async () => {
    const res = await request(app).post('/api/reviews/webhook')
      .set('x-emr-signature', 'invalid')
      .send({ event: 'review.created' });
    expect(res.status).toBe(401);
  });
});
```

#### Review deduplication

```typescript
it('does not create duplicate review on repeated webhook', async () => {
  const payload = { externalReviewId: 'google-123', rating: 5, ... };
  await request(app).post('/api/reviews/webhook').send(signedPayload(payload));
  await request(app).post('/api/reviews/webhook').send(signedPayload(payload));
  const reviews = await db('reviews').where({ external_review_id: 'google-123' });
  expect(reviews.length).toBe(1);
});
```

#### SEO audit triggering

```typescript
describe('POST /api/audits/bl/generate', () => {
  it('creates location_audit record and returns audit id', async () => {
    // Mock dataforseo.service calls
    jest.spyOn(dataForSEO, 'checkOnPageSeo').mockResolvedValue(mockOnPageResult);
    jest.spyOn(dataForSEO, 'submitLighthouseTask').mockResolvedValue('task-123');

    const res = await request(app)
      .post('/api/audits/bl/generate')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ locationId });
    
    expect(res.status).toBe(200);
    expect(res.body.auditId).toBeDefined();
    const audit = await db('location_audits').where({ id: res.body.auditId }).first();
    expect(audit.dfs_on_page_task_id).toBe('task-123');
  });
});
```

---

## End-to-End Tests (Playwright)

E2E tests run against a real dev environment. They test the full user journey from browser to database.

### Setup

```bash
cd e2e
cp .env.example .env.test
# Set E2E_BASE_URL=http://localhost:5173
# Set test user credentials
npx playwright install chromium
```

### Test suites to build

#### 1. Authentication

```typescript
test('user can register, verify email, and log in', async ({ page }) => {
  await page.goto('/register');
  await page.fill('[name=email]', 'e2e@example.com');
  await page.fill('[name=password]', 'Password123!');
  await page.fill('[name=businessName]', 'E2E Test Co');
  await page.click('[type=submit]');
  // Verify email step (mock Resend or use a real test inbox)
  await expect(page.locator('[data-testid=verify-email-notice]')).toBeVisible();
});

test('user can log in with Google OAuth', async ({ page }) => {
  // Requires Google test account; use in CI with mocked OAuth
  await page.goto('/login');
  await page.click('[data-testid=google-signin]');
  // ... OAuth flow
  await expect(page).toHaveURL('/dashboard');
});
```

#### 2. Onboarding

```typescript
test('new user completes 4-step onboarding wizard', async ({ page }) => {
  await loginAs(page, 'new-user');
  await expect(page).toHaveURL('/onboarding');
  // Step 1: Business details
  await page.fill('[name=businessName]', 'My Business');
  await page.click('[data-testid=next]');
  // Step 2: Location
  await page.fill('[name=address]', '123 Main St');
  await page.click('[data-testid=next]');
  // Step 3: Keywords
  await page.fill('[name=keyword]', 'plumber near me');
  await page.click('[data-testid=add-keyword]');
  await page.click('[data-testid=next]');
  // Step 4: Billing
  await expect(page.locator('[data-testid=billing-step]')).toBeVisible();
});
```

#### 3. SEO Audit

```typescript
test('user can trigger audit and see results', async ({ page }) => {
  await loginAs(page, 'existing-client');
  await page.goto('/audit-history');
  await page.click('[data-testid=run-audit-btn]');
  await expect(page.locator('[data-testid=audit-pending]')).toBeVisible();
  // Poll until audit completes (or mock the API)
  await expect(page.locator('[data-testid=on-page-score]')).toBeVisible({ timeout: 30000 });
});

test('user can download audit PDF', async ({ page }) => {
  await loginAs(page, 'client-with-audit');
  await page.goto('/audit-history');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('[data-testid=download-report-btn]'),
  ]);
  expect(download.suggestedFilename()).toMatch(/seo-audit.*\.pdf/);
});
```

#### 4. Review Management

```typescript
test('user can draft and approve AI review response', async ({ page }) => {
  await loginAs(page, 'client-with-reviews');
  await page.goto('/reviews');
  await page.click('[data-testid=review-item]:first-child [data-testid=draft-response]');
  await expect(page.locator('[data-testid=ai-draft]')).toBeVisible({ timeout: 10000 });
  await page.click('[data-testid=approve-response]');
  await expect(page.locator('[data-testid=response-approved]')).toBeVisible();
});
```

#### 5. Team Members

```typescript
test('team admin can invite staff member', async ({ page }) => {
  await loginAs(page, 'team-admin');
  await page.goto('/settings/team');
  await page.click('[data-testid=invite-member]');
  await page.fill('[name=inviteEmail]', 'staff@example.com');
  await page.selectOption('[name=role]', 'staff');
  await page.click('[data-testid=send-invite]');
  await expect(page.locator('text=Invite sent')).toBeVisible();
});

test('staff cannot access team management', async ({ page }) => {
  await loginAsTeamMember(page, 'staff');
  await page.goto('/settings/team');
  await expect(page.locator('[data-testid=invite-member]')).not.toBeVisible();
});
```

---

## Smoke Tests (Post-Deploy)

Run `scripts/smoke-test.sh` immediately after every production deploy:

```bash
#!/bin/bash
BASE=https://superlocalseo.com
FAIL=0

check() {
  local desc=$1 url=$2 expected=$3
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url")
  if [ "$status" != "$expected" ]; then
    echo "FAIL: $desc — got $status, expected $expected"
    FAIL=1
  else
    echo "OK:   $desc"
  fi
}

check "Liveness"  "$BASE/api/health/live"  200
check "Readiness" "$BASE/api/health/ready" 200
check "404 on unknown route" "$BASE/api/nonexistent" 404
check "Auth required on /api/clients" "$BASE/api/clients" 401
check "QR redirect returns 302" "$BASE/api/qr/r/testcode" 302

if [ $FAIL -ne 0 ]; then
  echo "Smoke tests FAILED"
  exit 1
fi
echo "All smoke tests passed"
```

---

## Coverage Targets

| Area | Target Coverage | Notes |
|---|---|---|
| `audit_score.service.ts` | ≥ 90% | Core scoring logic, many code paths |
| `dataforseo.service.ts` | ≥ 80% | Focus on `extractFailingAudits`, error branches |
| `audit_report.service.ts` | ≥ 75% | `buildPriorityActions`, `getOnPageTip` |
| Auth middleware | ≥ 95% | Security-critical |
| Webhook validators | 100% | Security-critical; all paths must be tested |
| Billing event handlers | ≥ 90% | Financial impact of bugs is high |
| RBAC middleware | ≥ 95% | Security-critical |

Run coverage:
```bash
npx vitest run --coverage
# or
npx jest --coverage
```

---

## CI/CD Testing Approach

### Recommended GitHub Actions pipeline

```yaml
name: CI

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
        working-directory: backend
      - run: npm test -- --coverage
        working-directory: backend
        env:
          DATABASE_URL: postgresql://slseo:slseo@localhost:5432/superlocalseo_test
          JWT_SECRET: ci-test-secret
          JWT_REFRESH_SECRET: ci-test-refresh
          ENCRYPTION_KEY: "0000000000000000000000000000000000000000000000000000000000000001"

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_DB: superlocalseo_test
          POSTGRES_USER: slseo
          POSTGRES_PASSWORD: slseo
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-retries 5

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npx tsc --noEmit
        working-directory: backend
      - run: npm ci && npx tsc --noEmit
        working-directory: frontend

  e2e:
    runs-on: ubuntu-latest
    needs: [unit-tests, typecheck]
    steps:
      - uses: actions/checkout@v4
      - run: docker compose up -d
      - run: npx playwright test
        working-directory: e2e
```

### What runs on every PR

1. TypeScript compilation (`tsc --noEmit`) — no type errors
2. Unit tests with coverage
3. Integration tests against test DB

### What runs on deploy to production

1. All of the above
2. Smoke tests against the deployed instance

---

## Load Testing

Use k6 to verify the platform handles realistic concurrency.

### Install

```bash
# macOS
brew install k6
# Linux
apt install k6
```

### Rankings load test

```javascript
// load/rankings.js
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 50,           // 50 virtual users
  duration: '60s',
};

const TOKEN = __ENV.TOKEN;

export default function () {
  const res = http.get('https://superlocalseo.com/api/rankings', {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  check(res, { 'status 200': (r) => r.status === 200 });
}
```

```bash
k6 run --env TOKEN=<jwt> load/rankings.js
```

### Targets

| Endpoint | Target | Max P95 Latency |
|---|---|---|
| `GET /api/rankings` | 50 concurrent | < 500ms |
| `GET /api/reviews` | 50 concurrent | < 500ms |
| `GET /api/health/ready` | 100 concurrent | < 100ms |
| PDF report generation | 5 concurrent | < 30s |

PDF generation is CPU/memory intensive (Puppeteer + Chromium). Keep concurrent PDF requests at ≤ 3 per node instance until moved to a dedicated queue worker.

---

## What NOT to Test

- **Third-party API responses** — mock them; don't make real DataForSEO/BrightLocal calls in tests.
- **Stripe payment flows** — use Stripe's test mode with test card numbers; no real charges.
- **Email delivery** — mock Resend in tests; only verify the payload being sent.
- **Redis internals** — use `ioredis-mock` in unit tests; real Redis in integration tests.
- **Docker container startup** — that's infrastructure, not application logic.
