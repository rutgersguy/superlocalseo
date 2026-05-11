
const { chromium } = require('/opt/superlocalseo/node_modules/playwright-core');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Capture API responses
  page.on('response', async (response) => {
    if (response.url().includes('/api/')) {
      let body = '';
      try { body = await response.text(); } catch(e) {}
      console.log('API Response:', response.url(), response.status(), body.slice(0, 200));
    }
  });
  
  page.on('console', msg => {
    console.log('Console:', msg.type(), msg.text());
  });
  
  page.on('pageerror', err => {
    console.log('Page error:', err.message);
  });

  await page.goto('http://localhost:5173/login');
  await page.waitForLoadState('networkidle');
  
  await page.getByLabel('Email').fill('nonexistent99999@test.com');
  await page.getByLabel('Password').fill('anything123');
  
  // Intercept before click
  const responsePromise = page.waitForResponse('**/api/auth/login', { timeout: 10000 });
  await page.getByRole('button', { name: 'Sign in' }).click();
  
  try {
    const response = await responsePromise;
    console.log('Login response status:', response.status());
    const body = await response.text();
    console.log('Login response body:', body);
  } catch(e) {
    console.log('No login response captured:', e.message);
  }
  
  await page.waitForTimeout(3000);
  
  const bodyText = await page.locator('body').innerText();
  console.log('Body after 3s:', bodyText.slice(0, 500));
  
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
