import { test, expect } from '@playwright/test';
import { loginViaUI } from './helpers/auth';
import { cleanupTestUsers } from './helpers/db';
import { createTestClient, TestClient } from './helpers/fixtures';
import { loadPriceBook, setupFeeEnabled, PriceBook } from './helpers/stripe';
import { BASE_URL } from './config';

/**
 * Suite 10 — Pricing consistency.
 *
 * Pricing copy is the most-repeated defect in this project: seven separate
 * incidents (#110, #111, #113, #116, #120, #125, #141/#142). Two of them showed a
 * user one price and charged another:
 *
 *   #113  Checkout summary was hardcoded to Pro. A user who picked Lite was
 *         charged Lite but shown $349/mo, a $499 setup fee, and $848 due today.
 *   #125  The Settings "Current plan" card quoted $349 plus the waived $499 setup
 *         fee to trialing users, who have not chosen a plan at all.
 *
 * The root cause is structural, not careless: price strings are hardcoded across
 * six independent React surfaces plus docs, e2e assertions and Stripe, with no
 * shared source of truth. PRICING.md carries a "keep these in sync" table and the
 * warning that this "has shipped to production twice" — which is now an
 * undercount.
 *
 * So this suite sweeps every surface in ONE pass and asserts against the live
 * Stripe price object. A test that hardcodes $149 only proves the test and the UI
 * agree with each other.
 */
test.describe('Suite 10 — Pricing consistency', () => {
  let prices: PriceBook | null;
  let client: TestClient;

  test.beforeAll(async () => {
    prices = await loadPriceBook();
    if (!prices) {
      console.warn(
        '  ⚠  Stripe credentials unavailable — asserting internal consistency only.\n' +
        '     The cross-check against what Stripe actually charges is SKIPPED.'
      );
    }
  });

  test.beforeEach(async () => {
    client = await createTestClient({ plan: 'pro', status: 'trialing', onboardingStep: 4 });
  });

  test.afterEach(() => {
    cleanupTestUsers();
  });

  // ------------------------------------------------- Stripe is the source of truth

  test('TEST-PRICE-01 — Stripe still charges the prices the product is sold on', async () => {
    test.skip(!prices, 'Stripe credentials unavailable');
    // Guards #141/#142: Lite lived at $99 in Stripe while the UI advertised $149.
    expect(prices!.lite, 'Stripe Lite base price').toBe(149);
    expect(prices!.pro, 'Stripe Pro base price').toBe(349);
    expect(prices!.extraLocation, 'Stripe additional-location price').toBe(125);
    expect(prices!.setupFee, 'Stripe setup fee (anchor only, must not be charged)').toBe(499);
  });

  test('TEST-PRICE-02 — the setup fee is switched off', async () => {
    // PRICING.md: the $499 object is kept in Stripe as an anchor, struck through
    // on the homepage, but never charged. If this flips on, every "waived" string
    // in the UI becomes a lie.
    expect(setupFeeEnabled(), 'STRIPE_SETUP_FEE_ENABLED should be unset/false').toBe(false);
  });

  // ------------------------------------------------------------- public surfaces

  test('TEST-PRICE-03 — Landing quotes Lite, Pro, the waived fee and per-location add-on', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const lite = prices?.lite ?? 149;
    const pro = prices?.pro ?? 349;
    const extra = prices?.extraLocation ?? 125;
    const setup = prices?.setupFee ?? 499;

    await expect(page.getByText(`$${lite}`, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`$${pro}`, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(new RegExp(`\\+\\$${extra}/mo per additional location`))).toBeVisible();

    // The fee must be struck through AND labelled waived — never presented as payable.
    const struck = page.locator('.line-through', { hasText: `$${setup}` });
    await expect(struck).toBeVisible();
    await expect(page.getByText('waived', { exact: true })).toBeVisible();
  });

  test('TEST-PRICE-04 — both plan CTAs offer the same 7-day trial', async ({ page }) => {
    // #112 made the CTAs symmetric: "Start with Lite" implied Lite had no trial.
    // #112/B25 also settled the trial length at 7 days after it was 14 in code
    // and 15 on the Landing page.
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const ctas = page.getByRole('link', { name: /start 7-day free trial/i });
    await expect(ctas).toHaveCount(2, { timeout: 15_000 });

    await expect(page.getByText(/\b14[- ]day\b/i)).toHaveCount(0);
    await expect(page.getByText(/\b15[- ]day\b/i)).toHaveCount(0);
  });

  test('TEST-PRICE-05 — the register plan picker matches Stripe', async ({ page }) => {
    await page.goto('/register');
    await page.waitForLoadState('networkidle');

    const lite = prices?.lite ?? 149;
    const pro = prices?.pro ?? 349;

    await expect(page.getByText(new RegExp(`\\$${lite}/mo`))).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(new RegExp(`\\$${pro}/mo`))).toBeVisible();
    // Both plans must advertise no setup fee at the point of choosing.
    await expect(page.getByText(/no setup fee/i).first()).toBeVisible();
  });

  // ------------------------------------------------------ the trialing user's view

  test('TEST-PRICE-06 — a trialing user is never shown a plan price as "theirs"', async ({ page }) => {
    // Regression guard for #125. Trials run as Pro but the user has chosen NO
    // plan, so quoting one — especially with a waived fee attached — is wrong.
    await loginViaUI(page, client.email, client.password);
    await page.goto('/dashboard/settings?tab=billing');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Free with full Pro Access')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/No card required/i)).toBeVisible();

    // The waived setup fee must not appear as a charge anywhere on this card.
    const body = await page.locator('body').innerText();
    expect(body, 'trialing billing card must not quote the setup fee as payable')
      .not.toMatch(/\$499\s*(setup|due|charge)/i);
  });

  test('TEST-PRICE-07 — the dashboard trial CTA leads with the entry price, not Pro', async ({ page }) => {
    // #120: the CTA advertised a flat $349/mo and Pro-only features to people who
    // might buy Lite.
    await loginViaUI(page, client.email, client.password);
    await page.waitForLoadState('networkidle');

    const lite = prices?.lite ?? 149;
    await expect(page.getByText(new RegExp(`\\$${lite}`)).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/no setup fee/i).first()).toBeVisible();
  });

  // --------------------------------------------------------------- checkout view

  test('TEST-PRICE-08 — Lite checkout shows the Lite price and no setup line', async ({ page }) => {
    // The #113 shape: displayed total must equal what Stripe will charge.
    await loginViaUI(page, client.email, client.password);

    // The plan carried into checkout comes from localStorage (Register.tsx:46).
    await page.evaluate(() => window.localStorage.setItem('selectedPlan', 'lite'));
    await page.goto('/billing?subscribe=1');
    await page.waitForLoadState('networkidle');

    const lite = prices?.lite ?? 149;
    await expect(page.getByText('Due today')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('No setup fee on Lite')).toBeVisible();

    const summary = await page.locator('body').innerText();
    expect(summary).toContain(`$${lite}`);
    // The Pro price must not appear on a Lite checkout at all.
    expect(summary, 'Lite checkout must not quote the Pro price')
      .not.toContain(`$${prices?.pro ?? 349}/mo`);
  });

  test('TEST-PRICE-09 — Pro checkout strikes the setup fee to zero', async ({ page }) => {
    await loginViaUI(page, client.email, client.password);
    await page.evaluate(() => window.localStorage.setItem('selectedPlan', 'pro'));
    await page.goto('/billing?subscribe=1');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('One-time setup fee')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Onboarding & citation audit — waived/)).toBeVisible();
    // Struck-through anchor, and $0 actually due.
    await expect(page.locator('.line-through', { hasText: '$499' })).toBeVisible();
    await expect(page.getByText('$0').first()).toBeVisible();
  });

  test('TEST-PRICE-10 — an empty localStorage does not silently downgrade the plan', async ({ page }) => {
    // Regression guard for 03c7fae: with no `selectedPlan`, checkout defaulted to
    // Lite, so a mid-funnel Pro-intent trialing user would have been billed Lite.
    await loginViaUI(page, client.email, client.password);
    await page.evaluate(() => window.localStorage.removeItem('selectedPlan'));
    await page.goto('/billing?subscribe=1');
    await page.waitForLoadState('networkidle');

    // Falls back to the client's own productLine, which is 'pro' here.
    await expect(page.getByText('One-time setup fee')).toBeVisible({ timeout: 20_000 });
  });

  test('TEST-PRICE-11 — /billing never flashes the payment form before resolving', async ({ page }) => {
    // Regression guard for #127 / b3d9b2a: `billing` was undefined on first paint,
    // so every early return fell through and the Stripe PaymentElement rendered
    // for a moment before being replaced by the trial splash.
    await loginViaUI(page, client.email, client.password);

    const sightings: string[] = [];
    await page.goto('/billing');
    // Sample the DOM repeatedly during the resolve window.
    for (let i = 0; i < 12; i++) {
      const hasForm = await page.locator('form, iframe[name^="__privateStripeFrame"]').count();
      const hasSplash = await page.getByText(/You're on a free trial/i).count();
      if (hasForm > 0 && hasSplash === 0) sightings.push(`t=${i * 250}ms form-only`);
      await page.waitForTimeout(250);
    }

    // Trial has 7 days left, so the soft landing is the correct destination —
    // the payment form must never have appeared on the way there.
    await expect(page.getByText(/You're on a free trial/i)).toBeVisible({ timeout: 15_000 });
    expect(sightings, `payment form flashed before the trial splash: ${sightings.join(', ')}`)
      .toEqual([]);
  });

  // ----------------------------------------------------------- known live defect

  test('TEST-PRICE-12 — structured data advertises the prices we actually sell', async () => {
    // Regression guard. index.html shipped the retired three-tier model in JSON-LD
    // (lowPrice 350 / highPrice 1200) long after pricing became $149/$349 — the
    // third occurrence of the hardcoded-price defect PRICING.md warns about.
    // Fixed in #153. index.html is now in the PRICING.md sync list.

    const html = await (await fetch(BASE_URL)).text();
    const match = html.match(/"lowPrice":\s*"(\d+)"[\s\S]*?"highPrice":\s*"(\d+)"/);
    expect(match, 'no AggregateOffer found in index.html').not.toBeNull();

    const [, low, high] = match!;
    expect(Number(low), 'JSON-LD lowPrice should be the Lite price').toBe(prices?.lite ?? 149);
    expect(Number(high), 'JSON-LD highPrice should be the Pro price').toBe(prices?.pro ?? 349);
  });
});
