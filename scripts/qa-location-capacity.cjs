const { chromium, expect } = require('@playwright/test');
const fs = require('fs');
const assert = require('assert/strict');
(async () => { assert(process.env.QA_CREDENTIALS_FILE); const account = JSON.parse(fs.readFileSync(process.env.QA_CREDENTIALS_FILE)).find(a => a.scenario === 'location'); assert(account.email.endsWith('@example.invalid')); const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }); try {
    const context = await browser.newContext({ baseURL: process.env.QA_BASE_URL || 'http://localhost:5273' });
    const page = await context.newPage();
    await page.goto('/login');
    await page.locator('input[type=email]').fill(account.email);
    await page.locator('input[type=password]').fill(account.password);
    const login = page.waitForResponse(r => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const auth = await (await login).json();
    const headers = { Authorization: `Bearer ${auth.data.accessToken}` };
    await page.waitForURL(/dashboard/);
    await page.goto('/dashboard/settings?tab=locations');
    const existing = (await (await context.request.get('/api/locations', { headers })).json()).data.find(l => l.name === 'QA 239 extra location');
    let created = existing ? { success: true, data: existing } : null;
    if (!created) {
        await page.getByRole('button', { name: 'Add location details', exact: true }).click();
        await page.getByPlaceholder('e.g. Main Office').fill('QA 239 extra location');
        const create = page.waitForResponse(r => r.url().endsWith('/api/locations') && r.request().method() === 'POST');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        created = await (await create).json();
        assert(created.success, JSON.stringify(created));
    }
    await expect(page.locator('span').filter({ hasText: 'QA 239 extra location' }).first()).toBeVisible();
    const overflow = await context.request.post('/api/locations', { headers, data: { name: 'Overflow must not be created' } });
    assert.equal(overflow.status(), 409);
    const removed = await context.request.delete(`/api/locations/${created.data.id}`, { headers });
    assert.equal(removed.status(), 204);
    const status = await (await context.request.get('/api/billing/status', { headers })).json();
    assert.equal(status.data.locationsLimit, 1);
    assert.equal(status.data.locationCount, 1);
    console.log(JSON.stringify({ locationDetails: 'created in browser', unpaidOverflow: 409, removal: 'capacity reduced to 1' }));
}
finally {
    await browser.close();
} })().catch(e => { console.error(e); process.exitCode = 1; });
