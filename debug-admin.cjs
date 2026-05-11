
const { chromium } = require('/opt/superlocalseo/node_modules/playwright-core');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    storageState: '/opt/superlocalseo/tests/e2e/.auth/admin.json',
    baseURL: 'http://localhost:5173',
  });
  const page = await ctx.newPage();
  
  page.on('response', async (resp) => {
    if (resp.url().includes('/api/')) {
      let body = '';
      try { body = await resp.text(); } catch(e) {}
      console.log('API:', resp.url().replace('http://localhost:5173', ''), resp.status(), body.slice(0, 100));
    }
  });
  
  await page.goto('http://localhost:5173/admin');
  await page.waitForTimeout(5000);
  console.log('URL:', page.url());
  const bodyText = await page.locator('body').innerText();
  console.log('Body:', bodyText.slice(0, 300));
  
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
