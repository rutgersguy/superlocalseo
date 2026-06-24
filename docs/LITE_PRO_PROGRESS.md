# Lite/Pro Split — Implementation Progress & Resume Notes

Working branch: **`feat/lite-pro-split`** (off `main`).
Spec of record: **`docs/IMPLEMENTATION_SPEC.md` on branch `proposed_rework`** (rev 3).

Goal: a `product_line: 'lite' | 'pro'` gate across the stack. **All existing clients
default to `'pro'` — zero disruption.** Lite = $99/mo, single location, no setup fee.

---

## Status

| Phase | Scope | State | Commit |
|---|---|---|---|
| 1 | Backend gate: capability map, migration, `requireProPlan`/`enforcePlanGate`, gate tests | ✅ Done | `5870fb5` |
| 2 | Stripe service + billing: `plan` param, `upgradeToProSubscription`, webhook flip, `/billing/upgrade`, `productLine` exposure | ✅ Done | `5857214` |
| 3 | **Frontend (NEXT)** — see below | ⬜ Not started | — |
| 4 | Lite onboarding e2e + open PR | ⬜ Not started | — |

Backend is feature-complete for the split. `tsc` clean. Test suite: 32 pass;
the only failures are **3 pre-existing webhook-signature tests** (fail identically
on clean `main` — unrelated to this work; flagged below).

---

## Phase 3 — Frontend (resume here tomorrow)

Spec parts 8–15. Suggested order (non-visual foundation first, then opinionated UI):

1. **Part 8** — `frontend/src/hooks/useClient.ts` (`productLine`, `isLite`, `isPro`). Foundation; everything else consumes it.
2. **Part 9/10** — `ProGate` component + plan-filtered nav in `DashboardLayout.tsx` (uses `frontend/src/config/planFeatures.ts`, already created in Phase 1).
3. **Part 12/13** — Competitors teaser (blurred upsell), Rankings/Dashboard/Settings Lite guards.
4. **Part 11** — single `Onboarding.tsx` with `?lite=1` 2-step mode (no keywords step).
5. **Part 14/15** — Register plan-picker, BillingPage upgrade CTA (calls `POST /billing/upgrade`), Audit→Lite default, `App.tsx` routing.
6. `cd frontend && npx tsc --noEmit`.

**Check in with Brent before the opinionated pieces** — Competitors teaser copy, upgrade CTA wording, Lite onboarding copy.

The frontend capability map (`frontend/src/config/planFeatures.ts`) already exists with
`NAV_ITEMS`, `PRO_SETTINGS_TABS`, `LITE_RANKINGS_HIDDEN`, `canAccess()`.

---

## Stripe (sandbox / test mode — acct `…cjar`)

Nothing more needed to build. Set up this session:
- Lite price **`price_1TlzpiBqpgOWcjarAXDqP1kT`** ($99/mo) → `STRIPE_LITE_BASE_PRICE_ID` in `/opt/superlocalseo/.env` (api container recreated, env loaded).
- Webhook `invoice.payment_succeeded` already enabled on the endpoint.
- Pro base $349 · setup $499 · location $125 (unchanged).
- **For live launch:** recreate the Lite price + webhook event in live mode and set the live env var.

---

## How to run the backend tests

Postgres test DB, Stripe mocked in `__tests__/setup.ts`:

```bash
docker exec -e NODE_ENV=test -e DATABASE_URL=postgresql://slseo:slseo@postgres:5432/superlocalseo_test \
  superlocalseo-api npx jest <pattern> --runInBand --forceExit
```

- Use `--runInBand` — parallel workers all run `migrate.latest()` on an empty DB and deadlock (12s timeouts).
- If the shared test DB gets polluted/flaky: drop + recreate `superlocalseo_test`, then `npm run migrate` once (or just let `setup.ts` migrate on next run).
- Type-check: `docker exec superlocalseo-api npx tsc --noEmit`.

---

## Gotchas discovered (don't re-learn these)

- **`req.client` is a built-in Node alias for the TCP socket** — always truthy. The
  `requireClient` idempotency guard keys off `req.clientId`, not `req.client`.
- **`requireProPlan` matches on `req.baseUrl + req.path`** — `req.path` is mount-stripped
  to `/` inside a path-mounted middleware.
- **Admin bypass uses `req.userRole`** (requireAuth sets that; there is no `req.user`).
- **`enforcePlanGate` passes anonymous requests through** so public subroutes under gated
  prefixes stay reachable (e.g. `POST /api/reviews/webhook`). The old index-level
  `requireActiveSubscription` was a no-op (req.userId not set until per-route requireAuth);
  billing is enforced by `requireClient.checkBillingAccess`.
- **Upgrade flips `product_line` on `invoice.payment_succeeded`**, never optimistically.

---

## Open items / follow-ups (not blocking)

- **Pre-existing:** `webhook-security.test.ts` — 3 "rejects bad signature" tests fail on
  clean baseline too. `POST /api/reviews/webhook` may not reject unsigned / bad-HMAC
  requests with 401. Worth a separate security look — NOT part of this work.
- Phase 4: add `tests/e2e/08-onboarding-lite.spec.ts` (spec Part 16.2) and open the PR.
