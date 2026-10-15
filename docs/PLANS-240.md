# Self-serve plans — October 2026

Implementation tested locally and in the isolated Stripe test stack. Production deployment verification is recorded below when complete.

`backend/src/config/plan-catalog.json` is the source of truth for new-plan prices,
limits, names and marketing features. The public `/api/billing/catalog` endpoint
supplies the frontend. Prices are cents in USD. Stripe lookup keys contain the
catalog version; old prices are never edited or deactivated by provisioning.

| Plan | Monthly | Annual, paid upfront | Included locations | Extra location monthly / annual |
| --- | ---: | ---: | ---: | ---: |
| Starter | $99 | $990 | 1 | Not available |
| Pro | $199 | $1,990 | 1 | $79 / $790 |
| Multi | $399 | $3,990 | 3 | $59 / $590 |

Annual billing provides twelve months for the price of ten: **two months free**.
This applies to base plans and location add-ons. Prices before tax and discounts
are shown separately from Stripe's exact amount due today. Prorated credits are
invoice credits, not promises of cash refunds. No setup fee or struck-through
setup-price anchor. No Google profile sync is included or advertised.

New accounts get 14 days of Pro features without a card. An explicit paid-plan
choice starts the subscription; expired trials cannot initiate paid scans.
Existing accounts retain the legacy pricing version and billing state. Stephen
Lindsey's account must not be repriced, activated, canceled, extended, or otherwise
changed as part of this rollout (owner explicitly requested leaving it alone).
His existing unpaid expired Stripe checkout is not an active subscription.

## Limits chosen for launch; review after 60–90 days

| Limit | Starter | Pro | Multi | Scope |
| --- | ---: | ---: | ---: | --- |
| Stored keywords | 10 | 30 | 50 | per location |
| Stored competitors | 0 | 5 | 10 | per location of purchased capacity, pooled per account |
| Largest grid | 3×3 | 13×13 | 13×13 | per scan |
| Grid scans | 2 | 10 | 20 | per location/calendar month |
| Ranking runs | 35 | 45 | 60 | per location/calendar month, includes scheduled/manual |
| AI engine/prompt checks | 96 | 144 | 240 | per location/calendar month, includes weekly/initial |
| Email review requests | 100 | 500 | 1,000 | per location/calendar month |
| Listing scans / website audits | 0 | 2 each | 4 each | per location/calendar month |
| Keyword discovery requests | 0 | 5 | 10 | per account/calendar month |
| SMS requests | 0 | 0 | 0 | disabled pending separate channel verification |
| Team seats | 1 | 5 | 15 | per account, includes owner and unexpired invitations |
| Maximum purchased locations | 1 | 20 | 50 | per account |

The additional ranking runs allow initial scans and occasional refreshes above
normal daily scheduling. AI allowance covers weekly scans including five-Monday
months at the current engine/prompt count. Multi gets higher software limits and
white-label PDFs, plus priority email support; no calls or done-for-you services.

Usage resets at the start of each UTC calendar month, including annual plans;
changing plans does not reset usage. Competitor refreshes have a pooled cap of
35 calls per allowed competitor each month, covering daily scheduling and initial setup. Reservations are atomic and occur before
provider calls. Attempted scans can consume allowance even if a vendor fails,
because the vendor may already have charged. There are no automatic overage
charges. Duplicate review-request retries do not consume another allowance.
Legacy accounts are excluded from the new quota policy.

## Plan changes and location removal

Plan/interval/location changes update the existing subscription, using an exact
Stripe preview and explicit confirmation. Payment failures retain the current
plan until payment succeeds. Price IDs, billing interval and included locations
are reconciled from Stripe's current subscription items, not mutable metadata on
the subscription. SetupIntent collects a card only when needed; $0 skips it.

When capacity is lower than existing location count, the customer must select
exactly which locations to remove. No location is automatically selected. The
preview names the locations and warns that their stored location data will be
permanently deleted; the customer can export data first. Removal happens only
after successful confirmation. Changed location membership invalidates a preview.
Pending changes block location creation/deletion. Downgrades with too many
keywords or team seats require explicit cleanup first; inaccessible competitor
history is retained on Starter. Stripe portal plan switching is disabled so it
cannot bypass location selection; invoices, payment methods and cancellation
remain available.

## Provisioning and QA

`node dist/scripts/configure-plan-catalog.js` inspects the catalog. `--apply`
creates the versioned products and all monthly/annual prices and disables portal
plan switching. Run in isolated Stripe test mode first; old prices remain active.
Migrations: `20261015120000_plan_catalog` and `20261015123000_checkout_attempts`.

Required release checks: six new signup plan/interval combinations; 14-day no-card
trial; $0 promo and saved/no-card checkout; existing-subscription plan and interval
switches; annual location additions; explicit downgrade selection and foreign-ID
rejection; concurrent confirmation and quotas; failed payment recovery; legacy
billing unchanged; cancellation; browser desktop/mobile pricing consistency;
full unit/integration suite, builds, deploy preflight, post-deploy verification.

## QA evidence before production rollout

- Full backend suite: 659 tests, 68 suites passed on a fresh database, including concurrent keyword/scan
  limits, trial duration, annual arithmetic, zero-dollar activation, and durable
  checkout retry after an ambiguous response.
- Stripe test-mode API: all six plan/interval signups, exact invoice-versus-preview
  equality, monthly-to-annual switching, annual add-ons, same-invoice retries,
  no duplicate subscriptions, required and foreign-location selection checks,
  selected-only location deletion, missing-card SetupIntent, declined payment
  recovery/cancellation, legacy prices unchanged, stale/expired previews, and
  subscription cancellation.
- Browser: desktop and 390px mobile pricing (no overflow), annual registration,
  annual upgrade/add-on, explicit downgrade selection, Starter map and locked
  feature prompts. No JavaScript page errors.
- Card collection uses the existing Payment Element. Automated no-card payment
  completion was verified through Stripe's supported test SetupIntent API; this
  is not a claim that browser CAPTCHA was automated.
- Backend/frontend builds, API error regression checks (14 passed), and deployment
  preflight passed. No real customer emails, review invitations, or replies were sent.

Reproducible runners: `scripts/qa-plan-catalog.cjs`,
`scripts/qa-plan-payment-recovery.cjs`, `scripts/qa-plan-browser.cjs`.
The API runners require the isolated container and refuse live Stripe keys.
Credentials stay in private mode-600 files. Cleanup with
`docker exec -i slseo-test-api node - --cleanup < scripts/qa-plan-catalog.cjs`.

## Review and rollback

Review usage and conversion after 60–90 days (December 14, 2026–January 13, 2027):
trial-to-paid conversion, Starter-to-Pro changes, recurring revenue excluding QA
accounts, provider spend per location, and counts of quota refusals. Revisit
limits using `plan_usage` totals and observed vendor costs, not advertised maxima.
A pricing change requires a new catalog version; do not edit subscribed Stripe
prices. Rollback should keep the new price IDs recognizable and preserve paid
entitlements and usage rows. Do not roll back schema while subscriptions use it.
Selected-location deletion is explicit and irreversible through the app; export
before confirming. Deployment backups remain the operator recovery path.
