
const { chromium } = require('/opt/superlocalseo/node_modules/playwright-core');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/login');
  await page.waitForLoadState('networkidle');
  
  await page.getByLabel('Email').fill('nonexistent99999@test.com');
  await page.getByLabel('Password').fill('anything123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  
  // Wait a bit
  await page.waitForTimeout(5000);
  
  // Check what's visible
  const bodyText = await page.locator('body').innerText();
  console.log('Body text excerpt:', bodyText.slice(0, 1000));
  
  const url = page.url();
  console.log('Current URL:', url);
  
  await browser.close();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
