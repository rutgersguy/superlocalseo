# SuperLocalSEO — Playwright Test Plan

## Environment

| Item | Value |
|------|-------|
| Frontend URL | `http://localhost:5173` |
| API URL | `http://localhost:3000` |
| DB (docker exec) | `docker exec superlocalseo-postgres psql -U slseo -d superlocalseo -c "..."` |
| Admin email | `hello@superlocalseo.com` |
| Admin password | *(use password reset if unknown — trigger via `/auth/forgot-password`)* |
| Playwright config | Root `playwright.config.ts` — create if absent, point `baseURL` at `http://localhost:5173` |

## Test data conventions

- Generate unique emails per run: `` `test+${Date.now()}@example.com` ``
- After each suite, delete test users from DB:  
  `DELETE FROM users WHERE email LIKE 'test+%@example.com';`
- DB teardown via `db` global fixture in `global-setup.ts`

---

## Spec files

```
tests/
  global-setup.ts          # create persistent admin session
  global-teardown.ts       # purge test+* users
  01-auth.spec.ts
  02-audit-lead.spec.ts
  03-onboarding-single.spec.ts
  04-onboarding-multi.spec.ts
  05-onboarding-skip-resume.spec.ts
  06-dashboard.spec.ts
  07-admin.spec.ts
```

---

## Suite 01 — Authentication (`01-auth.spec.ts`)

### Preconditions
- Fresh browser context per test (no stored cookies)
- Test user does not exist at start; cleaned up in afterEach

### TEST-AUTH-01 — Login with non-existent email shows register prompt

**Steps:**
1. Navigate to `/login`
2. Fill email: `nonexistent-${Date.now()}@example.com`
3. Fill password: `anything123`
4. Click "Sign in"

**Assertions:**
- Amber banner visible containing text "No account found for that email"
- Banner contains a link with text "Create account →"
- That link href contains `/register?email=` with the typed email URL-encoded
- No navigation away from `/login`

---

### TEST-AUTH-02 — Login with wrong password shows generic error

**Steps:**
1. Register a user via API: `POST /api/auth/register` with `{email, password:"correct123", businessName:"Test Biz"}`
2. Navigate to `/login`
3. Fill email with the registered email
4. Fill password: `wrongpassword`
5. Click "Sign in"

**Assertions:**
- Red error box visible containing "Invalid email or password"
- No amber "no account" banner visible
- Stays on `/login`

**Cleanup:** delete test user

---

### TEST-AUTH-03 — Google-only account shows Google hint

**Setup:** Via DB, insert a user with `google_id` set and `password_hash = NULL`  
`INSERT INTO users (email, google_id, role, email_verified) VALUES ('googleonly@example.com', 'fake-gid', 'client', true);`  
`INSERT INTO clients (user_id, business_name, subscription_status, trial_ends_at) VALUES ((SELECT id FROM users WHERE email='googleonly@example.com'), 'Google Biz', 'trialing', NOW() + INTERVAL '14 days');`

**Steps:**
1. Navigate to `/login`
2. Fill email: `googleonly@example.com`
3. Fill password: `anything`
4. Click "Sign in"

**Assertions:**
- Blue banner visible: "This account uses Google sign-in"
- "Sign in with Google" link visible inside banner

**Cleanup:** delete test user + client

---

### TEST-AUTH-04 — Registration pre-fills from URL params

**Steps:**
1. Navigate to `/register?email=prefilled%40example.com&business=My+Plumbing`

**Assertions:**
- Email input value equals `prefilled@example.com`
- Business Name input value equals `My Plumbing`
- Password field is empty

---

### TEST-AUTH-05 — Successful email registration and redirect

**Steps:**
1. Navigate to `/register`
2. Fill Business Name: `Playwright Test Biz`
3. Fill Email: unique test email
4. Fill Password: `SecurePass123!`
5. Click "Create account"

**Assertions:**
- Navigated to `/registered`
- Page contains "check your email" or similar confirmation text

**Cleanup:** delete test user

---

### TEST-AUTH-06 — Login "no account" banner links to register with pre-filled email

**Steps:**
1. Navigate to `/login`
2. Type email `noone@example.com`
3. Type any password
4. Submit
5. Click "Create account →" in the banner

**Assertions:**
- Navigated to `/register`
- Email input pre-filled with `noone@example.com`

---

## Suite 02 — Public Audit Lead (`02-audit-lead.spec.ts`)

### Preconditions
- No auth required
- Use a known real-ish business name for Google Places to return results (or mock the Places API call)

### TEST-AUDIT-01 — Audit form renders on `/audit`

**Steps:**
1. Navigate to `/audit`

**Assertions:**
- Page title / heading contains "audit" (case-insensitive)
- Business name input visible
- City input visible
- Keyword input visible
- Submit button visible

---

### TEST-AUDIT-02 — Running an audit shows results

**Steps:**
1. Navigate to `/audit`
2. Fill Business Name: `Starbucks`
3. Fill City: `Seattle`
4. Click the submit/scan button
5. Wait for results (up to 15s)

**Assertions:**
- Overall score visible (number between 0–100)
- Overall grade visible (A/B/C/D/F)
- At least 2 category cards visible
- At least 2 categories show a real score (not locked)
- At least 2 categories show lock icon / "Unlock with trial"

---

### TEST-AUDIT-03 — Email capture unlocks audit and shows register CTA

**Steps:**
1. Complete TEST-AUDIT-02 (have audit results on screen)
2. Locate email capture input
3. Enter a unique test email
4. Submit email capture form
5. Wait for unlock response

**Assertions:**
- All category cards now visible / unlocked
- "Start free 14-day trial" button visible
- That button href contains `/register?email=` with test email encoded
- That button href contains `&business=`

---

### TEST-AUDIT-04 — Register link from audit pre-fills registration form

**Steps:**
1. Complete TEST-AUDIT-03
2. Click "Start free 14-day trial"

**Assertions:**
- Navigated to `/register`
- Email input pre-filled with the test email from step 3 of TEST-AUDIT-03
- Business Name input pre-filled with the business name from the audit

---

## Suite 03 — Onboarding: Single Location (`03-onboarding-single.spec.ts`)

### Preconditions
- Fresh registered user with `onboarding_step = 0` (use API to register, then log in)
- Helper: `loginAs(page, email, password)` — POST `/api/auth/login`, store token in localStorage

### TEST-ONB-S-01 — New user is auto-redirected to `/onboarding`

**Steps:**
1. Register new user via API
2. Log in via UI (`/login`)
3. Wait for redirect

**Assertions:**
- URL is `/onboarding`
- Step indicator shows "Step 1 of 4"
- "Business Information" heading visible
- "Finish later" link visible

---

### TEST-ONB-S-02 — Step 1: fill business info and advance

**Steps:**
1. On `/onboarding` step 1
2. Clear and fill Business Name: `Acme Plumbing`
3. Select Industry: `Plumbing`
4. Click "Next"

**Assertions:**
- Step indicator shows "Step 2 of 4"
- "Your Locations" heading visible
- DB: `SELECT business_name, onboarding_step FROM clients WHERE ...` → `Acme Plumbing`, `2`

---

### TEST-ONB-S-03 — Step 2: add a single location

**Steps:**
1. On step 2
2. Click "+ Add location"
3. Fill Name: `Main Branch`
4. Fill Address: `123 Main St`
5. Fill City: `Austin`
6. Fill State: `TX`
7. Fill Zip: `78701`
8. Fill Phone: `512-555-0100`
9. Click "Add"
10. Click "Next"

**Assertions:**
- Location card showing "Main Branch" visible before clicking Next
- Step indicator shows "Step 3 of 4"
- "Target Keywords" heading visible

---

### TEST-ONB-S-04 — Step 3: add keywords for the single location

**Steps:**
1. On step 3, location "Main Branch" section visible
2. Type `plumber near me` in keyword input
3. Press Enter (or click Add)
4. Type `emergency plumber Austin`
5. Click Add button
6. Click "Next"

**Assertions:**
- Two keyword chips visible: "plumber near me" and "emergency plumber Austin"
- Step indicator shows "Step 4 of 4"
- "Connect your platforms" heading visible

---

### TEST-ONB-S-05 — Step 4: skip Google connection and finish

**Steps:**
1. On step 4 ("Connect your platforms")
2. Do NOT click "Connect Google"
3. Click "Finish"
4. Wait up to 15s for navigation

**Assertions:**
- Navigated to `/dashboard/settings` with `?tab=billing` in URL
- No redirect back to `/onboarding`
- DB: `onboarding_step = 4` for this client

---

### TEST-ONB-S-06 — Completed onboarding user is NOT re-redirected

**Steps:**
1. After completing onboarding (TEST-ONB-S-05)
2. Navigate to `/dashboard`

**Assertions:**
- URL remains `/dashboard` (no redirect to `/onboarding`)
- Dashboard heading / nav visible

---

### TEST-ONB-S-07 — Back button works between steps

**Steps:**
1. Start fresh onboarding session (onboarding_step = 0)
2. Complete step 1 (click Next)
3. On step 2, click "Back"

**Assertions:**
- Step indicator shows "Step 1 of 4"
- Business Name field retains value entered in step 1

---

---

## Suite 04 — Onboarding: Multiple Locations (`04-onboarding-multi.spec.ts`)

### Preconditions
Same as Suite 03 — fresh user with `onboarding_step = 0`

### TEST-ONB-M-01 — Add three locations in step 2

**Steps:**
1. Complete step 1 (Business Name: `Metro HVAC`, Industry: `HVAC`)
2. On step 2, add Location 1: `North Branch`, `100 N Oak Ave`, `Dallas`, `TX`, `75201`, `214-555-0101`
3. Add Location 2: `South Branch`, `200 S Elm St`, `Dallas`, `TX`, `75203`, `214-555-0202`
4. Add Location 3: `East Branch`, `300 E Pine Rd`, `Dallas`, `TX`, `75204`, `214-555-0303`
5. Click "Next"

**Assertions:**
- Three location cards visible before clicking Next, each with correct name
- Step 3 shows three sections, one per location (North Branch, South Branch, East Branch)

---

### TEST-ONB-M-02 — Step 3 shows keyword section per location

**Steps:**
1. On step 3 (after TEST-ONB-M-01)

**Assertions:**
- "North Branch" label visible
- "South Branch" label visible
- "East Branch" label visible
- Each location has its own keyword input field

---

### TEST-ONB-M-03 — Add different keywords per location

**Steps:**
1. In "North Branch" section: add `hvac repair dallas`, `furnace service`
2. In "South Branch" section: add `ac repair south dallas`
3. In "East Branch" section: add nothing (leave empty)
4. Click "Next"

**Assertions:**
- North Branch chips: "hvac repair dallas", "furnace service"
- South Branch chips: "ac repair south dallas"
- East Branch has no chips (acceptable to proceed)
- Step 4 visible after click

---

### TEST-ONB-M-04 — Remove a location in step 2

**Steps:**
1. Start fresh, complete step 1
2. Add two locations (Location A, Location B)
3. Click "Remove" next to Location A
4. Verify Location A is gone
5. Click "Next"

**Assertions:**
- Only Location B card visible
- Step 3 shows only one location section ("Location B" name)

---

### TEST-ONB-M-05 — Remove a keyword chip in step 3

**Steps:**
1. Complete steps 1–2 with one location
2. On step 3, add keywords: `kw1`, `kw2`, `kw3`
3. Click "×" on `kw2` chip

**Assertions:**
- Only `kw1` and `kw3` chips visible
- `kw2` is gone

---

### TEST-ONB-M-06 — Complete multi-location onboarding and land on dashboard

**Steps:**
1. Complete steps 1–4 with 3 locations, keywords on each, then click Finish

**Assertions:**
- Navigated to `/dashboard/settings?tab=billing`
- DB: `onboarding_step = 4`
- Navigating to `/dashboard` stays on `/dashboard` (no loop)

---

## Suite 05 — Onboarding: Skip & Resume (`05-onboarding-skip-resume.spec.ts`)

### TEST-ONB-SK-01 — "Finish later" from step 1 goes to dashboard

**Steps:**
1. New user, auto-redirected to `/onboarding` step 1
2. Fill Business Name: `Skip Test Co`
3. Click "Finish later"

**Assertions:**
- Navigated to `/dashboard`
- URL is NOT `/onboarding`
- DB: `onboarding_step = 1` (or current step), `business_name = 'Skip Test Co'`

---

### TEST-ONB-SK-02 — After "Finish later", next login does NOT auto-redirect

**Steps:**
1. After TEST-ONB-SK-01
2. Log out
3. Log back in with same credentials

**Assertions:**
- Not redirected to `/onboarding`
- Lands on `/dashboard`

---

### TEST-ONB-SK-03 — Manually returning to `/onboarding` resumes from saved step

**Steps:**
1. After TEST-ONB-SK-01 (skipped on step 1, `onboarding_step = 1`)
2. Navigate to `/onboarding`

**Assertions:**
- Step indicator shows "Step 1 of 4" (resumes at step 1 — the saved step)
- Business Name input is pre-filled with `Skip Test Co`

---

### TEST-ONB-SK-04 — "Finish later" from step 2 saves step 2

**Steps:**
1. New user → step 1 → click Next (advances to step 2)
2. On step 2, click "Finish later"
3. Navigate back to `/onboarding`

**Assertions:**
- DB: `onboarding_step = 2`
- Onboarding loads at step 2 ("Your Locations" heading)

---

### TEST-ONB-SK-05 — Completing onboarding after a skip does not loop

**Steps:**
1. After TEST-ONB-SK-03 (resumed onboarding)
2. Complete all steps through Finish

**Assertions:**
- Navigated to `/dashboard/settings?tab=billing`
- No redirect to `/onboarding`
- DB: `onboarding_step = 4`

---

## Suite 06 — Dashboard (post-onboarding) (`06-dashboard.spec.ts`)

### Preconditions
- User with `onboarding_step = 4` (completed onboarding)
- Use a persistent session saved by `global-setup.ts`

### TEST-DASH-01 — Dashboard loads with correct nav items

**Steps:**
1. Navigate to `/dashboard`

**Assertions:**
- Nav items visible: Dashboard, Rankings, Reviews, Campaigns, Competitors, Citations, SEO Audit, Reports, Settings
- Admin nav item NOT visible (non-admin user)
- Trial banner visible (if within 14-day trial window)

---

### TEST-DASH-02 — All nav routes are accessible without error

**Steps:**
For each route: `/dashboard/rankings`, `/dashboard/reviews`, `/dashboard/campaigns`, `/dashboard/competitors`, `/dashboard/citations`, `/dashboard/audit`, `/dashboard/reports`, `/dashboard/settings`:
1. Click nav item
2. Wait for page load

**Assertions:**
- Each route loads without blank screen or 404
- URL updates to expected path
- No JavaScript console errors logged for each route

---

### TEST-DASH-03 — Settings page has correct tabs, no Yelp panel

**Steps:**
1. Navigate to `/dashboard/settings`

**Assertions:**
- Tabs visible (at minimum: General, Integrations, Billing)
- Integrations tab: Google Business Profile card visible
- Integrations tab: Facebook card visible
- Integrations tab: NO card with text "Yelp"
- Integrations tab: NO text "BrightLocal" anywhere on page

---

### TEST-DASH-04 — Trial banner shows days remaining

**Steps:**
1. Navigate to `/dashboard`

**Assertions:**
- Banner containing "trial" or "day" visible
- Banner does NOT say "0 days" (unless trial expired)

---

### TEST-DASH-05 — Unauthenticated access redirects to login

**Steps:**
1. Clear all cookies / storage
2. Navigate to `/dashboard`

**Assertions:**
- Redirected to `/login`

---

## Suite 07 — Admin Panel (`07-admin.spec.ts`)

### Preconditions
- Logged in as `hello@superlocalseo.com` (admin role)
- Admin session saved in `global-setup.ts`

### TEST-ADMIN-01 — Admin nav item visible for admin user

**Steps:**
1. Login as admin
2. Navigate to `/dashboard`

**Assertions:**
- "Admin" nav item visible in sidebar (red text, ShieldAlert icon)
- Non-admin users do NOT see this item (verified in TEST-DASH-01)

---

### TEST-ADMIN-02 — Admin panel loads with Overview tab

**Steps:**
1. Click "Admin" in nav (or navigate to `/admin`)

**Assertions:**
- URL is `/admin`
- "Overview" tab active / visible
- Metric cards visible: Total Clients, Active, Trialing
- Numbers are non-negative integers
- System health section visible (DB, Redis status)

---

### TEST-ADMIN-03 — Clients tab loads and is searchable

**Steps:**
1. On `/admin`, click "Clients" tab

**Assertions:**
- Client list visible with at least 1 row (our test users)
- Each row shows: business name, email, plan, status
- Search input visible
- Type test email into search → filtered results show only matching client

---

### TEST-ADMIN-04 — Clients tab filters by status

**Steps:**
1. On Clients tab
2. If status filter exists, select "Trialing"

**Assertions:**
- All visible clients show "Trialing" status
- Other status clients not visible

---

### TEST-ADMIN-05 — Job Queues tab loads

**Steps:**
1. On `/admin`, click "Job Queues" tab

**Assertions:**
- Queue status cards visible (waiting, active, completed, failed counts)
- Each count is a non-negative integer
- Recent failures section visible (may be empty — that's fine)

---

### TEST-ADMIN-06 — Analytics tab loads charts

**Steps:**
1. On `/admin`, click "Analytics" tab

**Assertions:**
- "New signups" chart area visible
- "Clients by tier" section visible
- No JavaScript errors

---

### TEST-ADMIN-07 — Non-admin user cannot access `/admin`

**Steps:**
1. Log in as a regular client user
2. Navigate directly to `/admin`

**Assertions:**
- NOT shown the Admin page
- Either redirected to `/dashboard` or shown a 403/access-denied message

---

### TEST-ADMIN-08 — Admin can see newly registered test users in client list

**Steps:**
1. Register a new client user via API with a known business name
2. Log in as admin
3. Navigate to `/admin`, click Clients tab
4. Search for the new business name

**Assertions:**
- The newly registered client appears in the list
- Email, business name, plan, status all correct

---

## Test helpers / fixtures

### `helpers/auth.ts`
```typescript
export async function registerViaAPI(email: string, password: string, businessName: string) {
  const res = await fetch('http://localhost:3000/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, businessName }),
  });
  return res.json();
}

export async function loginViaUI(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dashboard|onboarding)/);
}

export async function setOnboardingComplete(email: string) {
  // Run via docker exec
  execSync(`docker exec superlocalseo-postgres psql -U slseo -d superlocalseo -c "
    UPDATE clients SET onboarding_step = 4
    WHERE user_id = (SELECT id FROM users WHERE email = '${email}');
  "`);
}
```

### `helpers/db.ts`
```typescript
import { execSync } from 'child_process';

export function dbQuery(sql: string): string {
  return execSync(
    `docker exec superlocalseo-postgres psql -U slseo -d superlocalseo -t -c "${sql.replace(/"/g, '\\"')}"`
  ).toString().trim();
}

export function cleanupTestUsers() {
  dbQuery("DELETE FROM users WHERE email LIKE 'test+%@example.com'");
}
```

### `global-setup.ts`
```typescript
// Save authenticated sessions to storageState files
// admin.json  — hello@superlocalseo.com
// client.json — a completed-onboarding test client (reused across suites)
```

---

## Playwright config (`playwright.config.ts`)

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /global-setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
  globalTeardown: './tests/global-teardown.ts',
});
```

---

## Execution order

```
global-setup   → create admin session, create reusable client session
01-auth        → login/register UX (isolated contexts)
02-audit-lead  → public audit flow (no auth)
03-onboarding-single  → fresh user × single location
04-onboarding-multi   → fresh user × 3 locations
05-onboarding-skip    → skip/resume (fresh user each test)
06-dashboard   → reuses completed-client session
07-admin       → reuses admin session
global-teardown → DELETE FROM users WHERE email LIKE 'test+%@example.com'
```

---

## Known limitations / notes

- Google OAuth cannot be automated in Playwright without mocking — skip OAuth login tests or mock the OAuth callback endpoint
- `complete-onboarding` triggers EMR provisioning (12s timeout) — tests should not depend on provisioning success, just on `onboarding_step = 4` DB state
- Email delivery (Resend) is not testable in dev — email-related assertions check UI state only, not inbox
- Landing page FAQ: assert NO text "BrightLocal" anywhere (`/audit`, `/`, `/register`)
- AuditHistory / Competitors: assert NO text "BrightLocal" on those routes
