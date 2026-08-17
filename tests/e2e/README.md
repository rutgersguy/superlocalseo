# End-to-end suite

## Status: **86 passed / 6 skipped / 0 failed**

Run 2026-08-17 against the isolated test stack, 3.7 minutes. The 6 skips are
deliberate: 4 in `02-audit-lead` (`describe.skip` — the feature moved off-app) and
2 in `11-issue-100-repro` (gated behind `RUN_COSTLY=1`).

## Running it

```bash
docker compose -f docker-compose.test.yml up -d --build
docker compose -f docker-compose.test.yml exec api node dist/db/migrate.js
docker compose -f docker-compose.test.yml exec api node dist/db/seed-test.js

E2E_BASE_URL=http://localhost:5273 npx playwright test

docker compose -f docker-compose.test.yml down -v     # -v wipes the data
```

Needs `.env.test` (gitignored — copy `.env.test.example`). Stripe **test-mode**
keys only: registration calls `createCustomer` synchronously, so a placeholder key
500s every signup and therefore every spec.

```bash
npm run e2e:typecheck        # type-check without running
npx playwright test --list   # collect without running
```

## The stack (#159)

Self-contained: its own Postgres, Redis, API and web on **55432 / 56379 / 3100 /
5273**, nothing shared with production.

- **`NODE_ENV=test`** — rate limiters skip. Every spec authenticates and the whole
  run comes from one IP, so `authLimiter` (10 per 15 min) would otherwise trip
  part-way through and report failures that are not app defects (#164).
- **`DISABLE_WORKERS=true`** — a run cannot spend DataForSEO or BrightLocal credit,
  provision an EmbedMyReviews organization, or send email.
- **web uses the `test` Dockerfile target** — the same production build plus an
  `/api` proxy, so the stack is one origin. A target rather than a bind-mounted
  config, because single-file bind mounts are inode-pinned on this host and
  silently ignore edits.

**Everything derives from `E2E_BASE_URL`** (`config.ts`): the DB container and
name, the API container, and the admin credentials. That is deliberate — the
helpers previously shelled into the *production* Postgres by name, so the browser
would hit the test stack while the helpers mutated live data. Deriving them from
one value makes that combination unreachable.

Production verified untouched after the run: users/clients/locations/reviews
unchanged at 6/5/3/8, zero stray `pw-%` users.

## Fixtures

`seed-test.js` is idempotent (it clears `%@fixture.test` first) and **refuses to
run** unless `NODE_ENV=test` and the database name contains `test`.

| Account | Plan / status | Data |
|---|---|---|
| `admin@fixture.test` | admin | — |
| `pro@fixture.test` | pro / active | location, 3 keywords, rankings (2 engines, both rank types, one NULL), 5 reviews, private feedback, campaign, citations |
| `lite@fixture.test` | lite / active | same |
| `trialing@fixture.test` | pro / trialing | — |
| `newuser@fixture.test` | pro / trialing, `onboarding_step 0` | none — the null-state account |

Password for all: `TestPass123!`

The reviews and campaigns matter: those suites were blocked for months because no
account on this host had any.

## Pointing at production

`E2E_BASE_URL=https://superlocalseo.com` still works and the helpers follow it.
It writes real users to the live database and cleans them up by email pattern —
use the test stack unless you are specifically verifying production.

## Cost and side-effect guardrails

| Action | Consequence |
|---|---|
| `POST /clients/complete-onboarding` (clicking **Finish**) | Provisions a real EmbedMyReviews organization, enqueues BrightLocal + DataForSEO pulls. **Spends real money.** |
| Rankings sync / geo-grid scan | DataForSEO, ~$0.002 per keyword·geo; a 7×7 grid ≈ $0.10 |
| BrightLocal Citation Builder **confirm** | $2/site, up to $30 per aggregator. **Never automate.** |
| "Post to Google" review reply | Publishes live and permanently to a real public Google listing. No sandbox, no undo. **Never automate.** |

`DISABLE_WORKERS=true` covers the background jobs; the table above is about
user-initiated actions a spec might click. Suite 11 is gated behind `RUN_COSTLY=1`
and must never run in CI.

## Suites

| File | Covers |
|---|---|
| `01-auth` | login/register UX and every error branch |
| `02-audit-lead` | `describe.skip` — feature moved off-app, safe to delete |
| `03/04/05-onboarding` | wizard, multi-location, skip & resume |
| `06-dashboard` | nav smoke — 8 of 11 only assert `innerText.length > 50`, worth rewriting |
| `07-admin` | admin console, plus a real 403 check |
| `08-lite-plan` | Lite plan gating |
| `09-new-user-zero-data` | the null-state account: render sweep, empty states, null counting/sorting, actionable failure paths, Lite's one scan |
| `10-pricing-consistency` | every price surface in one pass, asserted against the live Stripe price object |
| `11-issue-100-repro` | fresh vs. deleted-and-re-created account (`RUN_COSTLY=1`) |

## Lessons from the first real run

Worth knowing before writing more — all four cost real debugging time:

1. **`RETURNING id` with `psql -t` prints the value AND `INSERT 0 1`.** Using the
   raw output as a uuid produced `…\nINSERT 0 1` and broke every downstream
   foreign key. Use `dbScalar()`, not `dbQuery()`, for anything returning a value.
2. **Fixture names collide with assertions.** A fixture called *Fixture Admin*
   made `getByRole('link', {name: 'Admin'})` match the business-name pill as well
   as the nav link; a location called *Ungeocoded Office* matched a
   `/geocod/i` assertion inside an `<option>`. Name fixtures so they cannot appear
   in an assertion, and scope selectors.
3. **Never `waitForLoadState('networkidle')` on `/billing`.** Stripe's
   PaymentElement iframe keeps polling, so the network never goes idle and the
   wait times out before any assertion runs.
4. **The Admin nav link is outside `<nav aria-label="Dashboard navigation">`.**
   Scoping to that nav finds nothing.

## Conventions

- `helpers/fixtures.ts` — `createTestClient()` for plan/status/onboarding state;
  `seedLocation` / `seedKeyword` / `seedRankingSnapshot` for data;
  `watchPageErrors` for crash detection; `assertRendered` for a stricter
  "did it render" bar than a character count.
- Plan and subscription state is forced via SQL, because `product_line` only flips
  on a paid Stripe invoice.
- Don't reuse `storageState`. The refresh token is single-use and rotates; a reused
  state logs the next test out mid-run. Log in per test.
- Prefer structural selectors (`following-sibling`) over Tailwind classes.
- There are **no `data-testid` attributes** in the app — every selector is coupled
  to visible copy, placeholders or ARIA labels. That caused the 18-test breakage in
  `f46666d`. Add testids to forms as they are touched.
