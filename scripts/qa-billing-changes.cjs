// Explicit opt-in. Use only disposable test accounts; caller owns cleanup.
const { chromium, expect } = require('@playwright/test');
const fs = require('fs');
const assert = require('assert/strict');
(async () => {
    assert(process.env.QA_CREDENTIALS_FILE);
    const accounts = JSON.parse(fs.readFileSync(process.env.QA_CREDENTIALS_FILE));
    let currentPage;
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    try {
        for (const account of accounts.filter(a => !process.env.QA_SCENARIOS || process.env.QA_SCENARIOS.split(',').includes(a.scenario))) {
            assert(account.email.endsWith('@example.invalid'));
            const context = await browser.newContext({ baseURL: process.env.QA_BASE_URL || 'http://localhost:5273' });
            const page = await context.newPage();
            currentPage = page;
            page.setDefaultTimeout(30000);
            const errors = [];
            page.on('pageerror', e => errors.push(e.message));
            await page.goto('/login');
            await page.locator('input[type=email]').fill(account.email);
            await page.locator('input[type=password]').fill(account.password);
            const login = page.waitForResponse(r => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST');
            await page.getByRole('button', { name: 'Sign in', exact: true }).click();
            const auth = await (await login).json();
            assert(auth.success);
            const headers = { Authorization: `Bearer ${auth.data.accessToken}` };
            await page.waitForURL(/dashboard|onboarding/);
            await page.goto(account.scenario === 'card' ? '/billing?upgrade=1' : '/dashboard/settings?tab=billing');
            await expect(page).toHaveURL(/settings\?tab=billing/);
            await expect(page.getByText(/7 days left in trial/)).toHaveCount(0);
            const section = page.getByRole('region', { name: 'Change subscription' });
            if (account.scenario !== 'card')
                await section.getByRole('button', { name: account.scenario === 'location' ? 'Add location ($125/mo)' : 'Upgrade to Pro', exact: true }).click();
            await section.getByRole('textbox', { name: 'Promo code', exact: true }).fill('INVALID239CODE');
            await section.getByRole('button', { name: 'Preview change', exact: true }).click();
            await expect(section.getByRole('alert')).toContainText('Invalid or expired');
            await section.getByRole('textbox', { name: 'Promo code', exact: true }).fill(account.scenario === 'promo' ? account.promo : '');
            const previewResponse = page.waitForResponse(r => r.url().endsWith('/api/billing/changes/preview'));
            await section.getByRole('button', { name: 'Preview change', exact: true }).click();
            const preview = await (await previewResponse).json();
            assert.equal(preview.success, true, JSON.stringify(preview));
            const quote = preview.data;
            assert.equal(quote.amountDue === 0, account.scenario === 'promo');
            const before = await (await context.request.get('/api/billing/status', { headers })).json();
            assert.equal(before.data.productLine, account.scenario === 'location' ? 'pro' : 'lite');
            assert.equal(before.data.trialDaysLeft, null);
            const qrBefore = await context.request.get('/api/qr', { headers });
            if (account.scenario !== 'location')
                assert.equal(qrBefore.status(), 403);
            if (account.scenario === 'nocard') {
                assert(quote.needsCard);
                const setupResponse = page.waitForResponse(r => r.url().endsWith(`/api/billing/changes/${quote.id}/setup`));
                await section.getByRole('button', { name: 'Add payment card', exact: true }).click();
                const setup = await (await setupResponse).json();
                assert(setup.success);
                let card;
                await expect.poll(async () => { for (const frame of page.frames()) {
                    if (await frame.locator('input[name="number"]').count()) {
                        card = frame;
                        return true;
                    }
                } return false; }, { timeout: 30000 }).toBe(true);
                await card.locator('input[name="number"]').fill('4242424242424242');
                await card.locator('input[name="expiry"]').fill('1230');
                await card.locator('input[name="cvc"]').fill('123');
                assert.equal(process.env.QA_CONFIRM_SETUP_WITH_TEST_API, '1', 'Browser CAPTCHA requires explicit Stripe test-API QA mode');
                // Stripe's hosted CAPTCHA blocks unattended card submission on this host.
                // Confirm the real SetupIntent using Stripe's supported test PaymentMethod API;
                // do not intercept or disable CAPTCHA. Keep this coverage distinction explicit.
                const source = `const c=require('./dist/config').config;if(!c.stripe.secretKey.startsWith('sk_test_'))throw Error('Test mode required');const s=new(require('stripe'))(c.stripe.secretKey);s.setupIntents.confirm(process.argv[1],{payment_method:'pm_card_visa'}).then(x=>{if(x.status!=='succeeded')throw Error(x.status);console.log('SetupIntent succeeded via Stripe test API')}).catch(e=>{console.error(e.message);process.exitCode=1})`;
                require('child_process').execFileSync('docker', ['exec', 'slseo-test-api', 'node', '-e', source, setup.data.clientSecret.split('_secret_')[0]], { stdio: 'pipe' });
                const confirmed = await (await context.request.post(`/api/billing/changes/${quote.id}/confirm`, { headers })).json();
                assert.equal(confirmed.data?.status, 'succeeded', JSON.stringify(confirmed));
                await page.reload();
                await expect(page.getByText('Additional locations', { exact: true })).toBeVisible();
                console.log(JSON.stringify({ scenario: 'nocard', previewDue: quote.amountDue, result: 'succeeded', cardForm: 'rendered and filled', setupConfirmation: 'Stripe test API; browser CAPTCHA blocked', invoiceId: confirmed.data.invoiceId }));
                await context.close();
                continue;
            }
            const confirmation = page.waitForResponse(r => r.url().endsWith(`/api/billing/changes/${quote.id}/confirm`));
            await section.getByRole('button', { name: /^Confirm (upgrade|additional location)/ }).dblclick();
            const confirmed = await (await confirmation).json();
            assert.equal(confirmed.success, true, JSON.stringify(confirmed));
            if (account.scenario === 'decline') {
                assert.equal(confirmed.data.status, 'payment_required');
                await expect(section.getByText(/Complete payment to apply/)).toBeVisible();
                const current = await (await context.request.get('/api/billing/status', { headers })).json();
                assert.equal(current.data.productLine, 'lite');
                assert.equal(current.data.status, 'active');
                await page.reload();
                await expect(page.getByText(/Complete payment to apply/)).toBeVisible();
                await page.getByRole('button', { name: 'Cancel this change', exact: true }).click();
                await expect(page.getByRole('alert')).toContainText('canceled or expired');
            }
            else {
                assert.equal(confirmed.data.status, 'succeeded');
                await expect(section.getByRole('status')).toContainText(account.scenario === 'location' ? 'Location capacity added' : 'You’re on Pro');
                const retries = await Promise.all([1, 2].map(() => context.request.post(`/api/billing/changes/${quote.id}/confirm`, { headers })));
                for (const response of retries) {
                    const result = await response.json();
                    assert.equal(result.data?.status, 'succeeded', JSON.stringify(result));
                    assert.equal(result.data.invoiceId, confirmed.data.invoiceId);
                }
                const status = await (await context.request.get('/api/billing/status', { headers })).json();
                assert.equal(status.data.productLine, 'pro');
                assert.equal(status.data.status, 'active');
                assert.equal(status.data.locationsLimit, account.scenario === 'location' ? 2 : 1);
                const qr = await context.request.get('/api/qr', { headers });
                assert.equal(qr.status(), 200);
                await page.reload();
                await expect(page.getByText('Additional locations', { exact: true })).toBeVisible();
            }
            assert.deepEqual(errors, []);
            if (process.env.QA_SCREENSHOT_DIR) {
                fs.mkdirSync(process.env.QA_SCREENSHOT_DIR, { recursive: true });
                await page.screenshot({ path: `${process.env.QA_SCREENSHOT_DIR}/${account.scenario}.png`, fullPage: true });
            }
            console.log(JSON.stringify({ scenario: account.scenario, previewDue: quote.amountDue, result: confirmed.data.status, invoiceId: confirmed.data.invoiceId, duplicateRequests: 'safe', browserErrors: 0 }));
            await context.close();
        }
    }
    catch (error) {
        if (currentPage) {
            await currentPage.screenshot({ path: '/tmp/sls-239-failure.png', fullPage: true });
            console.error((await currentPage.locator('body').innerText()).slice(-8000));
            for (const frame of currentPage.frames()) {
                if (frame !== currentPage.mainFrame())
                    console.error('FRAME', frame.url().split('#')[0], (await frame.locator('body').innerText().catch(() => '')).slice(0, 1000));
            }
        }
        throw error;
    }
    finally {
        await browser.close();
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
