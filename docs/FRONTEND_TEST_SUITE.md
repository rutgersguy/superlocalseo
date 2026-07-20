# SuperLocalSEO — Front-End Test Suite (agent-runnable)

> **Purpose:** A thorough, click-by-click manual/agentic regression suite for the SuperLocalSEO web app, designed to be executed by **Claude Desktop** (or any agent) driving a real browser against the live site. Every test case is atomic: precondition → steps → expected result → record PASS / FAIL / BLOCKED.
>
> **Target:** `https://superlocalseo.com` (production build behind Cloudflare → nginx → prod nginx static + `/api` → Express).
> **Last verified against code:** `main`, 2026-07-20. Plan-gating source of truth: `frontend/src/config/planFeatures.ts`.

---

## 0. How to run this (instructions for Claude Desktop)

1. Use your browser connector (Claude-in-Chrome / browser tool). Open a fresh, logged-out tab before each **suite**.
2. Work **one test case at a time, in order**. Do exactly the steps listed — don't improvise navigation.
3. After each case, record one of: **PASS** / **FAIL** / **BLOCKED** (dependency or missing data) / **SKIP** (not applicable), plus a one-line note.
4. On any **FAIL**, capture a screenshot and the browser console (if reachable) before moving on.
5. Do **not** perform real payments. Stripe is in **test mode** — where a card is required use `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP. Stop before final confirmation unless the test explicitly says to complete it.
6. Do **not** run destructive admin actions (delete customer, deactivate promo) except where a case explicitly scopes them to throwaway data.
7. At the end, output the **Results Summary** table (template at the bottom).

### Test accounts

| Role | Email | Password | State |
|---|---|---|---|
| **Lite** | `info@nerdbox.com` | `LiteTest2026!` | Latino Tire · `lite`/active · 1 location · 5 keywords · onboarding complete |
| **Pro** | `brent@nerdbox.com` | `ProTest2026!` | NerdBox · `pro`/trialing (~1 day left → **red trial banner shows**) · 1 location · 7 keywords |
| **Admin** | `hello@superlocalseo.com` | `Admin#Test2026!` | Platform admin · sees all nav + red **Admin** link |

> Passwords set 2026-07-20. Login button label is **"Sign in"**. Auth token is stored as an **httpOnly cookie** (you won't see it in localStorage — that's expected).

### Known data caveats (read before running)

- **No account currently has any reviews or campaigns data.** The old reviews fixture (`client-a@example.com` / "Test Business") was wiped 2026-07-10. Reviews, Campaigns, and review-dependent metrics will render **empty states**. Cases that need populated data are marked **⚠ needs seed** — ask the operator to seed before asserting the populated UI.
- **GBP live reviews are blocked** at Google (quota approval pending), so "Connect Google" flows can be opened but not completed end-to-end.
- **Stripe is test-mode** — billing flows work but collect no real money.

### Known discrepancies to confirm (flag, don't auto-fail the app)

These were found during code review; a test that surfaces one should be marked **FAIL** with a note referencing the ID:
- **DISC-1**: Register plan selector + Billing summary show **Lite = $149/mo**, but the Stripe Lite price is **$99/mo**. Confirm which is authoritative.
- **DISC-2**: Lite onboarding uses `?lite=1` but `Onboarding.tsx` renders the **identical 4-step Pro flow** (no Lite-specific 2-step). Confirm intended.
- **DISC-3**: `/audit` is an **external redirect** to `app.superlocalseo.com/intel-request`, not the in-app audit. The in-app audit lives at `/dashboard/audit`.
- **DISC-4**: `/admin` has **no front-end role guard** — a non-admin who types the URL loads the shell (API calls should 403). Verify the API blocks data.

---

## Suite A — Authentication & account entry

| ID | Precondition | Steps | Expected |
|---|---|---|---|
| **AUTH-01** | Logged out | Go to `/login` | Email + Password fields, **Sign in** button, **Sign in with Google** button, "Forgot password?" link, "Start free trial" → `/register` footer link all render |
| **AUTH-02** | Logged out | `/login` → enter `info@nerdbox.com` / wrong password → Sign in | Red inline error "Invalid email or password"; stays on `/login` |
| **AUTH-03** | Logged out | `/login` → enter a non-existent email (e.g. `nobody+test@nerdbox.com`) / anything → Sign in | Amber "No account found" with **Create account →** link to `/register?email=…` |
| **AUTH-04** | Logged out | `/login` → `info@nerdbox.com` / `LiteTest2026!` → Sign in | Redirects to `/dashboard`; Latino Tire pill visible in sidebar |
| **AUTH-05** | Logged out | `/login` → `brent@nerdbox.com` / `ProTest2026!` → Sign in | Redirects to `/dashboard`; NerdBox pill; **red trial banner** ("Your trial ends in … / expired") with "Choose your plan →" |
| **AUTH-06** | Logged out | `/login` → `hello@superlocalseo.com` / `Admin#Test2026!` → Sign in | Redirects to `/dashboard` or `/admin`; sidebar shows all 9 items **plus** red **Admin** link |
| **AUTH-07** | Logged out | `/register` | Google button, **plan selector (Lite / Pro)**, Business Name / Email / Password (min 8) fields, **Create account** button. Note Lite price shown (**DISC-1** if $149) |
| **AUTH-08** | Logged out | `/register?plan=pro` | Pro is pre-selected in the plan toggle |
| **AUTH-09** | Logged out | `/register` → submit with existing email `info@nerdbox.com` | `EMAIL_TAKEN` handling: hint to sign in (yellow, "Sign in →") — no duplicate created |
| **AUTH-10** | Logged out | Register a throwaway: `qa+<timestamp>@nerdbox.com` / `QaTest2026!` / "QA Smoke Biz", plan Lite → Create account | Navigates to `/registered` ("Check your email") echoing the email; **Go to sign in** link. *(Keep this account for ONB suite; note the email.)* |
| **AUTH-11** | Logged out | `/auth/forgot-password` → enter `info@nerdbox.com` → **Send reset link** | Green "Check your email" confirmation with the email echoed; **Back to sign in** |
| **AUTH-12** | Logged out | `/auth/reset-password` (no `?token`) | "Invalid or missing reset token" + **Request a new link** |
| **AUTH-13** | Logged out | `/auth/verify-email` (no `?token`) | Error state "Verification failed" + **Back to sign in** |
| **AUTH-14** | Logged out | `/team/accept` (no `?token`) | Error state "Invite link invalid" + **Go to login** |
| **AUTH-15** | Logged out | Directly open `/dashboard` | Redirected to `/login` (ProtectedRoute) |
| **AUTH-16** | Logged in (any) | Click **Sign out** (sidebar bottom) | Session cleared; `/dashboard` now redirects to `/login` |

---

## Suite B — Onboarding (fresh account)

> Uses the throwaway account from **AUTH-10** (onboarding_step 0). If you skipped it, register a new `qa+<ts>@nerdbox.com`.

| ID | Precondition | Steps | Expected |
|---|---|---|---|
| **ONB-01** | Logged in as fresh QA account | Log in | Auto-redirect to `/onboarding` (Lite account → URL `…/onboarding?lite=1`). Header shows logo + **Finish later**; "Step 1 of 4" (**DISC-2**: still 4 steps even for Lite) |
| **ONB-02** | On Step 1 | Fill Business Name, pick an Industry from the grouped select → **Next** | Advances to Step 2 (Locations); no error banner |
| **ONB-03** | On Step 2 | Click **+ Add location** → fill Location name + Address (required) → **Add location** | Location appears in the list; form collapses; can **Remove** it |
| **ONB-04** | On Step 2, location added | In the service-area field type a city (e.g. "Tulsa") | Debounced autocomplete suggests cities; selecting adds a removable chip |
| **ONB-05** | On Step 3 | Add a keyword to the location (type + **Add** / Enter) | Keyword chip appears; is removable |
| **ONB-06** | On Step 4 | Observe Integrations step | **Google Business Profile** card with **Connect Google**; collapsible "Don't have a GBP yet?"; Facebook card links to Settings integrations |
| **ONB-07** | On Step 4 | Click **Finish** | "Setting up your review account…" → lands on `/dashboard`; onboarding no longer forces redirect |
| **ONB-08** | Mid-onboarding | Click **Finish later** on any step | Saves progress, navigates to `/dashboard` (or re-prompts onboarding on next login until finished) |
| **ONB-09** | Resume | Log out and back in before finishing | Onboarding resumes at the saved step with prior data pre-filled |

---

## Suite C — Dashboard shell, nav & plan gating

> The core Lite/Pro regression. Run once as **Lite**, once as **Pro**, once as **Admin**.

| ID | Plan | Steps | Expected |
|---|---|---|---|
| **NAV-01** | Lite | Log in, read the sidebar | Visible: Dashboard, Rankings, Reviews, Campaigns, **Competitors**, Reports, Settings. **Hidden: Citations, SEO Audit.** No Admin link |
| **NAV-02** | Pro | Read the sidebar | All 9: Dashboard, Rankings, Reviews, Campaigns, Competitors, **Citations, SEO Audit**, Reports, Settings. No Admin link |
| **NAV-03** | Admin | Read the sidebar | All 9 items **+ red Admin link** at the bottom |
| **NAV-04** | Lite | Manually navigate to `/dashboard/citations` | **ProGate** placeholder: "Citations is a Pro feature" + **Upgrade to Pro →** (goes to `/billing?upgrade=1`). No citation data loads |
| **NAV-05** | Lite | Manually navigate to `/dashboard/audit` | **ProGate**: "SEO Audit is a Pro feature" + Upgrade CTA |
| **NAV-06** | Lite | Open `/dashboard/competitors` | **Teaser**: blurred faux rows + lock overlay "See who's outranking you" + **Upgrade to Pro →**. (No competitor API calls fire) |
| **NAV-07** | Pro | Open `/dashboard/competitors` | Real competitors UI (Overview / Keyword Rankings / Discover Keywords tabs), not a teaser |
| **NAV-08** | Lite | Business-name pill (green dot) click | Navigates to `/dashboard` |
| **NAV-09** | Pro | Observe trial banner | Red urgent banner (≤2 days) "Your trial ends in 1 day." with **Choose your plan →** → `/billing` |
| **NAV-10** | Any | Shrink to mobile width | Hamburger appears; opens/closes the sidebar overlay |
| **NAV-11** | Admin | Navigate to `/admin` | Admin console loads (see Suite M) |

---

## Suite D — Dashboard home (`/dashboard`)

| ID | Plan | Steps | Expected |
|---|---|---|---|
| **DASH-01** | Lite | Load `/dashboard` | Metric cards render: Avg Rank, Keywords in Top 10, Total Reviews, Avg Rating (values may be 0). **No** Local SEO Score / Citation Score cards, **no** ROI section, **no** "Run SEO Audit" quick action |
| **DASH-02** | Pro | Load `/dashboard` | Same 4 metric cards **plus** Local SEO Score + Citation Score (2nd row) and the ROI section ("Unlock your ROI estimate" if unconfigured); **Run SEO Audit** quick action present |
| **DASH-03** | Any | Observe Top Keywords table | Shows up to 10 rows (Lite/Pro accounts have keywords); **View all →** goes to Rankings. If empty: "No ranking data yet…" |
| **DASH-04** | Pro | Observe trial state | **SubscribeCTA** ("from $149/mo", **Choose your plan →**) present because status = trialing |
| **DASH-05** | Any (Google not connected) | Observe banners | **GBPNudgeBanner** (blue, "Connect Google →") appears since onboarding ≥4 and Google not connected |
| **DASH-06** | Any | Click **Generate Report** quick action | Routes to `/dashboard/reports` |

---

## Suite E — Rankings (`/dashboard/rankings`)

| ID | Plan | Steps | Expected |
|---|---|---|---|
| **RANK-01** | Pro | Load page | Header shows **Keywords** toggle, **ROI** toggle, **Export CSV**, and a Refresh/Scan control. Summary cards (Avg Rank, Keywords Tracked, In Top 3, Gains) when rows>0 |
| **RANK-02** | Lite | Load page | **No Export CSV, no ROI toggle, no Visibility Map tab.** "Scan now" only if the one-time manual scan is unused; otherwise no refresh button |
| **RANK-03** | Any | Click **Keywords** toggle | KeywordsPanel opens: location select, keyword list with **Remove**, add input + **Add** |
| **RANK-04** | Any | Add a keyword ("test coffee shop") via the panel | Appears as a row; may show "Awaiting scan" pending state |
| **RANK-05** | Any | Remove that keyword | Row disappears (DELETE succeeds) |
| **RANK-06** | Pro | Click the **📍 Visibility Map** tab | GeoGridPanel: Location + Keyword selects, **Run Scan** button, Leaflet map area |
| **RANK-07** | Lite | Confirm no Visibility Map tab exists | Only the Rankings Table tab present |
| **RANK-08** | Pro | Click **Export CSV** | A CSV download begins (rankings export) |
| **RANK-09** | Any | Use the table search box | Filters keyword rows live; column sort (Rank/Change/Updated) works |
| **RANK-10** | Pro | Toggle **ROI** on | Extra "Search Vol." + "Est. Revenue / mo" columns appear; RoiConfigPanel accessible |

---

## Suite F — Reviews (`/dashboard/reviews`) ⚠ needs seed

> All plans can reach Reviews. **Without seeded reviews these render empty** — the empty-state cases still validate.

| ID | Steps | Expected (empty) | Expected (seeded) |
|---|---|---|---|
| **REV-01** | Load page | **EMRSetupBanner** ("Connect your Google Business Profile", dismissible) since 0 reviews/feedback; charts show "No data yet" | Banner hidden; charts populated |
| **REV-02** | Header buttons | **Sync Reviews** and **Export CSV** buttons present | same |
| **REV-03** | Filter bar | Platform (All/Google/Yelp/Facebook), Rating (All/5..1), Status (All/New/Responded), search all render | filters narrow the list |
| **REV-04** | Tabs | **Reviews** / **Private Feedback** (with count badge) toggle | Private feedback lists 1–3★ items |
| **REV-05** ⚠ | Open a review card → **Respond** | *(BLOCKED without seed)* | ResponsePanel: **Draft AI response**, Regenerate, Edit, **Save / Save & Approve**, Approve, Copy |
| **REV-06** ⚠ | On an EMR Google review → **Post to Google** | *(BLOCKED)* | PostReplyModal with AI-draft textarea + **Post to Google** |
| **REV-07** | Empty list message | "No reviews found matching your filters." / "No private feedback yet" | n/a |

---

## Suite G — Campaigns (`/dashboard/campaigns`) ⚠ needs seed

| ID | Steps | Expected |
|---|---|---|
| **CAMP-01** | Load page | **EMRSetupBanner** (0 campaigns); **CreditBadge** (email/sms counts, may show "connect"); empty "No campaigns yet" |
| **CAMP-02** | Click **New Campaign** | Modal step "pick": TemplatePicker + "Start from scratch" |
| **CAMP-03** | Pick a template → step "name" | Campaign name input, **Back**, **Create Campaign** |
| **CAMP-04** ⚠ | Expand a created campaign | Funnel bars (Invited/Opened/Clicked/Reviewed/Private feedback/Unsubscribed) + review-rate % |
| **CAMP-05** ⚠ | Single invite tab | First name*, Last name, Email, Phone (email or phone required), **Send invite** |
| **CAMP-06** ⚠ | Bulk CSV tab | Upload CSV or paste; preview first 5; **Send N invites** |
| **CAMP-07** | Unsubscribed section | Expands; empty "No unsubscribes yet" |

---

## Suite H — Competitors (`/dashboard/competitors`)

| ID | Plan | Steps | Expected |
|---|---|---|---|
| **COMP-01** | Lite | Load page | Teaser only (see NAV-06) — no data fetches |
| **COMP-02** | Pro | Load page | Header **Run scan** (or "Next scan tomorrow…") + **Add competitor**; tabs Overview / Keyword Rankings / Discover Keywords |
| **COMP-03** | Pro | Click **Add competitor** | Modal with Google Places search (type a business name), name*, website field, Place ID; **Add** |
| **COMP-04** | Pro | Overview tab | Your-business stats card; competitor rows with star rating, sync, delete-with-confirm; **Battleground** gap table (All/Losing/Winning/Uncontested filters). Empty: "No competitors yet" |
| **COMP-05** | Pro | Keyword Rankings tab | HeadToHead matrix (You vs each competitor). Empty: "No head-to-head data yet" |
| **COMP-06** | Pro | Discover tab | Competitor select + **Discover keywords**; results table with **Add** per keyword |

---

## Suite I — Citations (`/dashboard/citations`, Pro-only)

| ID | Plan | Steps | Expected |
|---|---|---|---|
| **CIT-01** | Lite | Navigate to `/dashboard/citations` | ProGate "Citations is a Pro feature" (dupe of NAV-04) |
| **CIT-02** | Pro | Load page | Tabs **Directories** / **Submissions**; **Show errors only** toggle; NAP-error count line |
| **CIT-03** | Pro | Directories tab | Summary bar (listed/total, NAP %), "Completeness over time" chart (30d/90d), directory grid cards (Listed/Not listed, NAP match). Empty: "No directory data available yet." |
| **CIT-04** | Pro | Submissions tab | Table Directory/Status/Submitted/Live; empty "No submissions yet." |

---

## Suite J — SEO Audit (`/dashboard/audit`, Pro-only)

| ID | Plan | Steps | Expected |
|---|---|---|---|
| **AUD-01** | Lite | Navigate to `/dashboard/audit` | ProGate "SEO Audit is a Pro feature" |
| **AUD-02** | Pro | Load page | "Local SEO Audit" header; location select (if >1); **Run Audit** (disabled if audit <1 day old); **Download Report** (only if a prior audit exists). Empty: "No audit data yet." |
| **AUD-03** | Pro | ScoreCards (if data) | On-Page SEO, Reviews, Google Profile cards with deltas; Recommendations; Website Performance (LCP/CLS/TBT); Score History chart |
| **AUD-04** | Any | Navigate to top-level `/audit` | **DISC-3**: external redirect to `app.superlocalseo.com/intel-request` — NOT the in-app audit |

---

## Suite K — Reports (`/dashboard/reports`, all plans)

| ID | Steps | Expected |
|---|---|---|
| **REP-01** | Load page | **Generate Report** button; **DataExports** grid (Rankings History, Keywords, Reviews, Citations); reports table or empty "No reports yet…" + "Generate your first report" |
| **REP-02** | Click **Generate Report** | Modal: Month + Year selects, **Generate**; toast on queue |
| **REP-03** | Click a DataExports tile (e.g. Keywords) | CSV download begins (per-button spinner) |
| **REP-04** | If a report row exists | **Preview** opens PDF in modal/iframe; **Download**; **Re-send** reopens prefilled modal |

---

## Suite L — Settings (`/dashboard/settings`, tabs gated)

| ID | Plan | Steps | Expected |
|---|---|---|---|
| **SET-01** | Pro | Load Settings | Tabs: Account, Locations, Keywords, Integrations, Billing, **Team**, Widgets, **QR Codes** |
| **SET-02** | Lite | Load Settings | Same **minus Team and QR Codes** (Pro-gated) |
| **SET-03** | Any | Account tab | Email (readonly), Business Name, Industry select, **Save changes** (+ "Saved!"); ROI settings section |
| **SET-04** | Any | Locations tab | Location list with inline edit + delete-confirm; **Add location** form |
| **SET-05** | Any | Keywords tab | Per-location add/delete; "add a location first" if none |
| **SET-06** | Any | Integrations tab | **GoogleConnectCard** (Connect Google); **Facebook** card marked *coming soon* / disabled |
| **SET-07** | Any | Billing tab | Current-plan card ($149 Lite / $349 Pro / "Free with full Pro Access" while trialing); status badge; Locations usage (count/limit); action button varies by state |
| **SET-08** | Pro | Widgets tab | Embed code + **Copy**; appearance config + live preview; **Regenerate widget key** |
| **SET-09** | Pro | QR Codes tab | Create form (name, review URL) + list with download/delete |
| **SET-10** | Pro | Team tab | Member list with **Remove**; **Invite** (email + role). *(Do not remove real members)* |
| **SET-11** | Any | Deep-link `/dashboard/settings?tab=integrations` | Opens directly on the Integrations tab |

---

## Suite M — Admin console (`/admin`, admin account)

| ID | Steps | Expected |
|---|---|---|
| **ADMIN-01** | Log in as admin → `/admin` | "Internal" badge; tabs: Overview, Clients, Customers, Promo Codes, Job Queues, Analytics, Citations |
| **ADMIN-02** | Overview tab | Platform stat cards + service HealthDots |
| **ADMIN-03** | Clients tab | Search + paginated table (prev/next) |
| **ADMIN-04** | Customers tab | Search table; row shows Stripe presence; **Edit** opens modal (do **not** save changes to real customers) |
| **ADMIN-05** | Promo Codes tab | **Create** form (code, type, value, duration, max redemptions). *(Create a throwaway `QATEST` if you want to exercise it, then deactivate it)* |
| **ADMIN-06** | Job Queues tab | Queue table with status dots (failures/processing/healthy) |
| **ADMIN-07** | Analytics tab | Revenue/metrics by month render |
| **ADMIN-08** | Citations tab | **+** opens AdminCitationWizard (client/location pick, package, directories). *(Cancel — don't create a real campaign)* |
| **ADMIN-09** (DISC-4) | As **Lite** user, type `/admin` in the URL | Shell may render, but API data calls should **403** (no admin data shown). Flag if real admin data leaks |

---

## Suite N — Billing & checkout (`/billing`)

> Stripe **test mode**. Use `4242 4242 4242 4242`. **Do not complete** a subscription unless the case says so.

| ID | Plan | Steps | Expected |
|---|---|---|---|
| **BILL-01** | Pro (trialing, >3 days) | Open `/billing` | Soft landing "You're on a free trial" + **Back to dashboard** / **Subscribe early anyway →**. *(NerdBox has ~1 day left, so it may go straight to checkout instead — either is valid; note which)* |
| **BILL-02** | Lite | Open `/billing?upgrade=1` | Checkout with **Pro** forced in Plan Summary; "Due today" shows prorated/monthly; Stripe PaymentElement on the right |
| **BILL-03** | Any | On checkout, enter promo code (invalid) → **Apply** | Error shown; no discount applied |
| **BILL-04** | Any | Inspect Plan Summary pricing | Lite $149 / Pro $349, setup "$499 struck → $0". **DISC-1** if Lite differs from Stripe's $99 |
| **BILL-05** | Any (from BillingTab) | Settings → Billing → main action button | trialing → "Choose your plan & subscribe now →"; needs-sub → "Subscribe now/Reactivate"; active → "Manage payment & invoices →" (Stripe portal) |
| **BILL-06** | Any | `/billing/success?...redirect_status=succeeded` | "You're in!" success view with **Go to dashboard →** |

---

## Suite O — Cross-cutting / resilience

| ID | Steps | Expected |
|---|---|---|
| **X-01** | Visit an unknown route e.g. `/nope` | Redirects to `/` (catch-all) |
| **X-02** | `/privacy` and `/terms` | Static legal pages render |
| **X-03** | Verify-email banner (as a fresh unverified account) | Blue banner with **Resend email**; **✕** dismisses for the session |
| **X-04** | Reload any dashboard page (F5) | No auth loss (cookie persists), no dev-server/source exposure (prod build), page re-renders |
| **X-05** | Open DevTools console on 3 pages | No uncaught red errors (warnings ok); note any that appear |
| **X-06** | Try `/src/main.tsx` directly | Serves `index.html` (SPA fallback), raw source NOT exposed |

---

## Results Summary (fill in and return)

```
Run date/time (CT):
Browser:
Tester: Claude Desktop

Suite A (Auth)          PASS __ / FAIL __ / BLOCKED __
Suite B (Onboarding)    PASS __ / FAIL __ / BLOCKED __
Suite C (Nav/Gating)    PASS __ / FAIL __ / BLOCKED __
Suite D (Dashboard)     PASS __ / FAIL __ / BLOCKED __
Suite E (Rankings)      PASS __ / FAIL __ / BLOCKED __
Suite F (Reviews)       PASS __ / FAIL __ / BLOCKED __   (⚠ needs seed)
Suite G (Campaigns)     PASS __ / FAIL __ / BLOCKED __   (⚠ needs seed)
Suite H (Competitors)   PASS __ / FAIL __ / BLOCKED __
Suite I (Citations)     PASS __ / FAIL __ / BLOCKED __
Suite J (SEO Audit)     PASS __ / FAIL __ / BLOCKED __
Suite K (Reports)       PASS __ / FAIL __ / BLOCKED __
Suite L (Settings)      PASS __ / FAIL __ / BLOCKED __
Suite M (Admin)         PASS __ / FAIL __ / BLOCKED __
Suite N (Billing)       PASS __ / FAIL __ / BLOCKED __
Suite O (Resilience)    PASS __ / FAIL __ / BLOCKED __

FAILURES (id — one line each):

DISCREPANCIES CONFIRMED (DISC-1..4):

NOTES / DATA GAPS:
```
</content>
</invoke>
