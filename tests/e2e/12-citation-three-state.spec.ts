import { test, expect } from '@playwright/test';
import { loginViaUI } from './helpers/auth';
import { cleanupTestUsers, dbQuery } from './helpers/db';
import { createTestClient, seedLocation, watchPageErrors, assertRendered, TestClient } from './helpers/fixtures';

/**
 * Suite 12 — Citation verification is three-state (#174).
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * Citation auditing moved off BrightLocal onto our own DataForSEO scanner, and
 * with it came a state the UI never had to render: `unverified` — we looked and
 * could not determine the answer.
 *
 * It matters because the two ways of getting this wrong both harm the customer,
 * in opposite directions:
 *
 *   - Showing `unverified` as "Not listed" sends them to create a listing they
 *     may already have. Duplicate listings actively damage local ranking, so
 *     that advice leaves them worse off than not running the audit.
 *
 *   - Showing a listing whose NAP we could not read as "matches" asserts a
 *     check we never performed. The previous panel did exactly this: it
 *     rendered `nameMatch === false ? X : Check`, so null — "not readable" —
 *     displayed a green tick.
 *
 * Both are silent failures: the page looks completely normal in each case,
 * which is precisely why they need a test rather than a glance.
 */

let client: TestClient;
let locationId: string;

/**
 * Logs in and opens Citations by CLICKING the nav link.
 *
 * `page.goto('/citations')` does not work, for two separate reasons that both
 * look like a broken page: the route is nested under /dashboard, and a full page
 * load drops the in-memory access token, so the app bounces to the sign-in
 * screen. Navigating the way a user does avoids both.
 */
async function openCitations(page: import('@playwright/test').Page): Promise<void> {
  await loginViaUI(page, client.email, client.password);
  await page.getByRole('link', { name: /citations/i }).first().click();
  await assertRendered(page, /Citations/i);
}

test.beforeAll(async () => {
  client = await createTestClient({ businessName: 'Citation State Co' });
  locationId = seedLocation(client.email, { name: 'Citation State Co', city: 'Bixby', state: 'OK' });

  // One row per state, plus a listing found with an unreadable NAP — the case
  // that produced a false "matches".
  dbQuery(`
    INSERT INTO citation_snapshots
      (location_id, directory, listed, verification_status, unverified_reason, nap_match, pulled_at,
       nap_name_match, nap_address_match, nap_phone_match, listed_address)
    VALUES ('${locationId}', 'manta', false, 'not_found', NULL, false, NOW(), NULL, NULL, NULL, NULL),
           ('${locationId}', 'foursquare', false, 'unverified', 'no result matched this business',
            false, NOW(), NULL, NULL, NULL, NULL)
  `);

  // A PARTIALLY readable listing — the common real case. Name read and matched,
  // address read and wrong, phone not present in the snippet at all. All three
  // must render differently; before the fix the unreadable phone showed a green
  // tick and the word "matches".
  dbQuery(`
    INSERT INTO citation_snapshots
      (location_id, directory, listed, verification_status, nap_match, listing_url, pulled_at,
       nap_name_match, nap_address_match, nap_phone_match, listed_name, listed_address)
    VALUES ('${locationId}', 'yelp', true, 'listed', false, 'https://yelp.com/biz/x', NOW(),
            true, false, NULL, 'Citation State Co', '505 N Armstrong St Ste AB., Bixby, OK 74008')
  `);

  // Listed, NAP unreadable: every match field null. Must render "not checked",
  // never "matches".
  dbQuery(`
    INSERT INTO citation_snapshots
      (location_id, directory, listed, verification_status, nap_match, listing_url, pulled_at,
       nap_name_match, nap_address_match, nap_phone_match, listed_name)
    VALUES ('${locationId}', 'facebook', true, 'listed', NULL, 'https://facebook.com/x', NOW(),
            NULL, NULL, NULL, 'Citation State Co')
  `);
});

test.afterAll(async () => {
  await cleanupTestUsers();
});

test('renders all three verification states distinctly', async ({ page }) => {
  const errors = watchPageErrors(page);
  await openCitations(page);

  await expect(page.getByText('Listed', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Not listed', { exact: true }).first()).toBeVisible();

  // The state that did not previously exist. If this reads "Not listed", the
  // customer is being told to create a listing we never actually checked for.
  await expect(page.getByText("Couldn't check").first()).toBeVisible();

  errors.assertNoCrash('citations three-state');
});

test('an unverified directory is never shown as the customer\'s problem', async ({ page }) => {
  await openCitations(page);

  // Grey, not red. Colour is the whole message here: red says "you must fix
  // this", and we do not know that there is anything to fix.
  const unverified = page.getByText("Couldn't check").first();
  await expect(unverified).toHaveClass(/text-gray-500/);
});

test('summary divides by what was checked, not by every known directory', async ({ page }) => {
  await openCitations(page);

  // 4 snapshots: 2 listed, 1 not_found, 1 unverified → 3 checked.
  // Dividing by 4 would count our own blind spot as a missing listing.
  await expect(page.getByText(/listed \/ 3 checked/)).toBeVisible();
  await expect(page.getByText(/1 couldn't be checked/)).toBeVisible();
});

test('a listing whose NAP could not be read does not claim the fields match', async ({ page }) => {
  await openCitations(page);

  // Facebook: nothing readable at all, so the card says so up front rather than
  // offering a comparison it cannot make.
  await expect(page.getByText('Listing found — details not readable').first()).toBeVisible();

  // Yelp: partially readable. Expanding must distinguish all three outcomes.
  await page.getByRole('heading', { name: 'Yelp', exact: true }).click();

  await expect(page.getByText('matches').first()).toBeVisible();            // name
  await expect(page.getByText('505 N Armstrong St Ste AB.')).toBeVisible(); // address, wrong
  // The regression guard: a field we could not read must NOT claim to match.
  await expect(page.getByText('not checked').first()).toBeVisible();
});
