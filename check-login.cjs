
const { chromium } = require('/opt/superlocalseo/node_modules/playwright-core');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/login');
  await page.waitForLoadState('networkidle');
  
  const labels = await page.locator('label').all();
  for (const l of labels) {
    const text = await l.textContent();
    console.log('Label:', JSON.stringify(text));
  }
  
  const inputs = await page.locator('input').all();
  for (const i of inputs) {
    const type = await i.getAttribute('type');
    const id = await i.getAttribute('id');
    console.log('Input type:', type, 'id:', id);
  }

  try {
    const emailInput = page.getByLabel('Email');
    await emailInput.waitFor({timeout: 3000});
    await emailInput.fill('test@test.com');
    console.log('getByLabel Email: OK');
  } catch(e) {
    console.log('getByLabel Email FAILED:', e.message.slice(0, 150));
  }
  
  await browser.close();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
