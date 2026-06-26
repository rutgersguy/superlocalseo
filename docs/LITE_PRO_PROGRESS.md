# Lite/Pro Split — Implementation Progress & Resume Notes

Working branch: **`feat/lite-pro-split`** (off `main`).
Spec of record: **`docs/IMPLEMENTATION_SPEC.md` on branch `proposed_rework`** (rev 3).

Goal: a `product_line: 'lite' | 'pro'` gate across the stack. **All existing clients
default to `'pro'` — zero disruption.** Lite = $99/mo, single location, no setup fee.

---

## Status — ALL PHASES COMPLETE

| Phase | Scope | State | Commit |
|---|---|---|---|
| 1 | Backend gate: capability map, migration, `requireProPlan`/`enforcePlanGate`, gate tests | ✅ | `5870fb5` |
| 2 | Stripe service + billing: `plan` param, `upgradeToProSubscription`, webhook flip, `/billing/upgrade`, `productLine` | ✅ | `5857214` |
| 3a | `useClient`, `ProGate`, plan-filtered nav | ✅ | `87e3a55` |
| 3b | Competitors teaser + Rankings/Settings guards + upgrade setup-fee waiver | ✅ | `583a9e6` |
| 3c | Register plan picker | ✅ | `d17ecd0` |
| 3d | BillingPage plan checkout + Lite→Pro upgrade flow | ✅ | `e3d7fec` |
| 3e | Dashboard Lite guards | ✅ | `f1dfef7` |
| 4 | e2e for Lite gating | ✅ | `fffc5cd` |

Backend + frontend `tsc` clean. Backend suite 32 pass (3 pre-existing webhook-sig
failures, unrelated). Lite e2e: 3/3 green.

## Product decisions (deviations from spec rev 3)

- **Option B funnel:** trials run as **Pro** (let everyone taste Pro); the chosen
  plan applies **at checkout**, and `product_line` flips to `'lite'` only on a Lite
  payment. Register stores the chosen plan in `localStorage`; BillingPage passes it
  to `subscription-intent`.
- **Consequence:** the spec's 2-step Lite onboarding is **not built** — nobody is
  Lite during onboarding. Everyone onboards as Pro. (`OnboardingRedirect` keeps a
  harmless `?lite=1` branch that is currently a no-op.)
- **Upgrade setup fee waived:** Lite→Pro upgrade charges only the prorated monthly
  difference, **no $499 setup fee** (existing paying customer).
- **Pro price shown as $349/mo** (matches the actual Stripe price; spec said $350).

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

## Open items / follow-ups

- **Verify the upgrade *payment* flow in the sandbox** (unit tests mock Stripe): real
  Lite checkout → webhook → `product_line='lite'`, and Lite→Pro `?upgrade=1` → proration
  invoice → `product_line='pro'`. Click through once before going live.
- **Live Stripe:** recreate the Lite price + `invoice.payment_succeeded` webhook event in
  live mode and set the live `STRIPE_LITE_BASE_PRICE_ID`.
- **Pre-existing (separate):** `webhook-security.test.ts` — 3 "rejects bad signature" tests
  fail on clean baseline too. `POST /api/reviews/webhook` may not reject unsigned / bad-HMAC
  requests with 401. Worth a security look — NOT part of this work.
- BillingPage upgrade view reuses the new-subscription form copy; could get
  upgrade-specific wording in a follow-up (functional as-is).
