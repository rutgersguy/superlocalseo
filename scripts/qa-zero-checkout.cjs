// Explicit opt-in browser QA: fixtures must be disposable, fresh accounts.
// Caller owns fixture creation and MUST cancel/delete Stripe customers afterwards.
// QA_CREDENTIALS_FILE: [{ email, password, plan: 'lite'|'pro' }]
// QA_PROMO_CODE must be a 100%-off code for the first invoice.
const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  assert(process.env.QA_CREDENTIALS_FILE && process.env.QA_PROMO_CODE, 'Explicit fixtures and promo required');
  const accounts = JSON.parse(fs.readFileSync(process.env.QA_CREDENTIALS_FILE, 'utf8'));
  const baseURL = process.env.QA_BASE_URL || 'http://localhost:5173';
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const account of accounts) {
      assert(account.email.endsWith('@example.invalid'), 'Only disposable QA accounts allowed');
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.setDefaultTimeout(30000);
      await page.goto('/login');
      await page.locator('input[type=email]').fill(account.email);
      await page.locator('input[type=password]').fill(account.password);
      const login = page.waitForResponse(r => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      const auth = await (await login).json();
      assert(auth.success);
      const headers = { Authorization: `Bearer ${auth.data.accessToken}` };
      await page.waitForURL(/dashboard|onboarding/);
      await page.evaluate(plan => localStorage.setItem('selectedPlan', plan), account.plan);
      const initial = page.waitForResponse(r => r.url().endsWith('/api/billing/subscription-intent'));
      await page.goto('/billing?subscribe=1');
      const initialBody = await (await initial).json();
      assert.equal(initialBody.success, true);
      assert.equal(initialBody.data.paymentRequired, true);
      assert(initialBody.data.clientSecret);
      await page.getByPlaceholder('Promo code').fill('INVALIDZEROQA');
      await page.getByRole('button', { name: 'Apply', exact: true }).click();
      await expect(page.getByText('Invalid or expired promo code', { exact: true })).toBeVisible();
      await page.getByPlaceholder('Promo code').fill(process.env.QA_PROMO_CODE);
      const discounted = page.waitForResponse(r => r.url().endsWith('/api/billing/subscription-intent'));
      await page.getByRole('button', { name: 'Apply', exact: true }).click();
      const discountedBody = await (await discounted).json();
      assert.equal(discountedBody.success, true);
      assert.equal(discountedBody.data.clientSecret, null);
      assert.equal(discountedBody.data.paymentRequired, false);
      await expect(page.getByRole('heading', { name: 'Subscription activated', exact: true })).toBeVisible();
      await expect(page.getByText(/Your invoice is \$0/)).toBeVisible();
      const status = await (await context.request.get('/api/billing/status', { headers })).json();
      assert.equal(status.data.status, 'active');
      assert.equal(status.data.productLine, account.plan);
      assert(status.data.currentPeriodEnd);
      // Delayed webhooks from the superseded unpaid checkout must not revoke access.
      for (let sample = 0; sample < 6; sample++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const current = await (await context.request.get('/api/billing/status', { headers })).json();
        assert.equal(current.data.status, 'active');
        assert.equal(current.data.productLine, account.plan);
      }
      const repeat = await context.request.post('/api/billing/subscription-intent', { headers, data: { plan: account.plan } });
      assert.equal(repeat.status(), 409);
      if (process.env.QA_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.QA_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: `${process.env.QA_SCREENSHOT_DIR}/${account.plan}-zero-checkout.png`, fullPage: true });
      }
      await page.reload();
      await expect(page.getByRole('heading', { name: "You're already subscribed", exact: true })).toBeVisible();
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ plan: account.plan, normalPayment: 'requires confirmation', invalidPromo: 'rejected', zeroPayment: 'activated', reload: 'active', duplicateCheckout: 409, browserErrors: errors.length }));
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
