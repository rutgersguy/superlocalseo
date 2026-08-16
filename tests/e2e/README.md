# End-to-end suite

## Status: written, **not yet run**

Suites 09, 10 and 11 were authored on 2026-08-16 and have been **type-checked and
collected but never executed**, by request — they should not run until the
production issues they were written against are fixed. Expect selector churn on
the first real run.

Suites 01–08 were verified passing on 2026-08-16 (49/49 runnable) once the base
URL was corrected.

## Why the base URL moved

The suite hardcoded `http://localhost:5173` in three places. Commit `1ce0f32`
(2026-07-10) switched the web container from the Vite dev server to a static nginx
production build, and `frontend/nginx-frontend.conf` deliberately does **not**
proxy `/api` — the outer reverse proxy does that on the public domain only.

Result: `POST http://localhost:5173/api/auth/login` → **405 Not Allowed**. Global
setup timed out and **all 56 tests were unrunnable for five weeks**. Nobody
noticed because CI never invokes Playwright.

The target now lives in one place, `tests/e2e/config.ts`, and defaults to the
public origin because that is currently the only origin serving both the SPA and
`/api`.

```bash
# default target: https://superlocalseo.com  (PRODUCTION — writes to the live DB)
npx playwright test

# point at a test stack once one exists
E2E_BASE_URL=http://localhost:5273 npx playwright test

# type-check without running anything
./backend/node_modules/.bin/tsc -p tsconfig.e2e.json

# collect tests without running them
npx playwright test --list
```

## ⚠️ These tests write to the production database

`helpers/db.ts` shells out to `docker exec superlocalseo-postgres psql`. Specs
register real users (`pw-*@test.com`) and delete them in `afterEach` plus global
teardown. There is no isolation, no seeding and no rollback, which is also why
`workers: 1` is mandatory.

**This is the top item to fix.** A second compose stack with its own Postgres and
an `/api` proxy in the frontend container removes the risk and unlocks parallelism.

## Cost and side-effect guardrails

| Action | Consequence |
|---|---|
| `POST /clients/complete-onboarding` (clicking **Finish**) | Provisions a real EmbedMyReviews organization, enqueues BrightLocal + DataForSEO pulls. **Spends real money.** |
| Rankings sync / geo-grid scan | DataForSEO, ~$0.002 per keyword·geo; a 7×7 grid ≈ $0.10. Balance was **$23.82** on 2026-08-16. |
| BrightLocal Citation Builder **confirm** | $2/site, up to $30 per aggregator. **Never automate.** |
| "Post to Google" review reply | Publishes live and permanently to a real public Google listing. No sandbox, no undo. **Never automate.** |

Suite 11 is gated behind `RUN_COSTLY=1` for exactly this reason and must never run
in CI.

## Suites

| File | Covers | State |
|---|---|---|
| `01-auth` | login/register UX, error branches | passing |
| `02-audit-lead` | in-app audit lead magnet | `describe.skip` — feature moved off-app, safe to delete |
| `03/04/05-onboarding` | wizard, multi-location, skip & resume | passing |
| `06-dashboard` | nav smoke | passing, but 8 of 11 only assert `innerText.length > 50` — worth rewriting |
| `07-admin` | admin console + a real 403 check | passing |
| `08-lite-plan` | Lite plan gating | passing — the model to copy |
| `09-new-user-zero-data` | **the null-state account**: render sweep, empty states, null counting/sorting, actionable failures, Lite's one scan | new, unrun |
| `10-pricing-consistency` | every price surface swept in one pass, asserted against the live Stripe price object | new, unrun |
| `11-issue-100-repro` | fresh vs. deleted-and-re-created account | new, unrun, `RUN_COSTLY=1` |

## Tests expected to fail

Two use `test.fail()` to document live defects — they will alert when the bug is
fixed:

- **TEST-ZD-13** — `Rankings.tsx:316,640` link to `/settings?tab=locations`, which
  is not a route. The catch-all dumps logged-in users on the marketing homepage.
  Correct target: `/dashboard/settings?tab=locations`.
- **TEST-PRICE-12** — `frontend/index.html:35-36` ships JSON-LD advertising the
  retired `$350–$1200` tiers.

## Known blockers these suites cannot work around

- **Stripe webhooks all fail signature verification.** Global `express.json()`
  (`app.ts:36`) pre-parses the body, so the route-level `express.raw()` on
  `/api/billing/webhook` is skipped. Paying does not flip `product_line`, so
  "user converts from trial to paid" is untestable end to end until it is fixed.
- **Citations returns no data.** BrightLocal's Data API 401s and
  `jobs/citations.job.ts` discards rejections without logging. Latest snapshot is
  2026-05-18. Assert the empty state, not data.
- **No `data-testid` anywhere.** Every selector is coupled to visible copy,
  placeholders or ARIA labels — which is what caused the 18-test breakage in
  `f46666d`. Add testids to forms as they are touched.

## Conventions

- `helpers/fixtures.ts` — `createTestClient()` for plan/status/onboarding state,
  `seedLocation` / `seedKeyword` / `seedRankingSnapshot` for data, `watchPageErrors`
  for crash detection, `assertRendered` for a stricter "did it render" bar.
- Plan and subscription state is forced via SQL because `product_line` only flips
  on a paid Stripe invoice, which currently cannot be delivered.
- Don't reuse `storageState`. The refresh token is single-use and rotates; a reused
  state logs the next test out mid-run. Log in per test.
- Prefer structural selectors (`following-sibling`) over Tailwind classes.
