# Pricing Model

## Current Tiers — Lite/Pro (implemented, PR #102/#103)

| Plan | Monthly | Setup | Locations | Scope |
|---|---|---|---|---|
| **Lite** | $149/mo | none | 1 only | Dashboard, Rankings (read-only), Reviews, Campaigns, Reports, Settings + a blurred Competitors upgrade teaser |
| **Pro** | $349/mo | ~~$499~~ **waived** | 1 (+$125/mo each) | Full suite: geo-grid heatmaps, citation auditing, competitor intelligence, SEO audits, team members, QR codes, analytics/CSV exports |

- All existing clients default to **Pro** (zero disruption). New signups choose at registration; **trials run as Pro** and the plan applies at checkout (`product_line` flips to `lite` only on a paid Lite invoice).
- **Setup fee is waived** (decided 2026-06-29 — margins are ~97%, the fee was a conversion tax). The $499 price object is kept in Stripe as a pricing anchor (struck through on the homepage) but is **not charged** on new subscriptions. Gated by `STRIPE_SETUP_FEE_ENABLED` in `config.ts` (default `false`); set it to `true` to reintroduce the fee without code changes.
- **Lite→Pro upgrade** is self-serve and prorated, with no setup fee (already the case in code — upgrade never added a setup item).
- Stripe prices (sandbox): Lite `STRIPE_LITE_BASE_PRICE_ID` ($149/mo) · Pro base $349/mo · setup $499 (anchor only, not charged) · additional location $125/mo. The flip is driven by the `invoice.payment_succeeded` webhook.
- Enforcement architecture: `config/planFeatures.ts` capability map + `requireProPlan`/`enforcePlanGate`. See [LITE_PRO_PROGRESS.md](LITE_PRO_PROGRESS.md).

### ⚠️ Where pricing is displayed — keep these in sync

Hardcoded pricing has shipped to production **twice** (PR #113: `BillingPage` checkout summary
was hardcoded to Pro and charged Lite users the wrong displayed amount; PR #125: the Settings
"Current plan" card quoted **$349 + the waived $499 setup fee to trialing users**, who have not
picked a plan at all). **Derive from `productLine`; never hardcode a price or a setup fee.**

| Surface | File | Notes |
|---|---|---|
| Checkout summary | `BillingPage.tsx` | Derives from `planForCheckout` via the `PLAN_DETAILS` map — display must equal charge |
| Current-plan card | `Settings.tsx` (BillingTab) | Reads `productLine` from `/billing/status` |
| Trial upsell banner | `Dashboard.tsx` | "from $149/mo · No setup fee" |
| Registration plan picker | `Register.tsx` | |
| Landing page + FAQ | `Landing.tsx` | |
| **SEO structured data** | `frontend/index.html` | JSON-LD `AggregateOffer` `lowPrice`/`highPrice`. **Easy to miss — it is not React.** It shipped the retired $350–$1200 tiers to Google for months (#153). |
| `BillingWall.tsx` | — | **Dead code — unrouted.** Its checkout call POSTs no `plan`, so the backend defaults to `'pro'`: reviving it as-is would bill Pro with no chance to pick Lite. |

### Vendor cost: BrightLocal Active Sync (quoted 2026-07-14)

GBP business-info sync (hours, categories, description, NAP, attributes — **text only, no
photos**) is only available via BrightLocal **Active Sync**, which needs a paid **Manage** or
**Grow** plan. We are on a **free** account today, so this is **new spend**. No per-request API
fees; rate limit 300/min.

| Locations | Manage /mo | Manage /yr | Grow /mo | Grow /yr |
|---|---|---|---|---|
| 10 | $109 | $980 | $131 | $1,178 |
| 50 | $384 | $3,455 | $494 | $4,445 |
| 100 | $769 | $6,920 | $989 | $8,900 |

Effective per-location on Manage: ~$10.90 (10), ~$7.68 (50), ~$7.69 (100). Annual saves 25%.
Against Pro at $349/mo/client (+$125/mo per extra location), margin is not a concern.

**Take Manage, not Grow.** Grow's premium is review monitoring/response — and BrightLocal
**cannot post review replies via API at all** ("We don't support Review Response via API").
Reviews and replies both go through EMR. Grow buys nothing we can use.

### Trial UX (Option B funnel)

Trials run with **full Pro access** (`product_line` is `NOT NULL DEFAULT 'pro'`, so it is never
null — the `?? 'pro'` fallback in `billing.controller.ts` is dead defensive code). The plan is
chosen **at checkout**, and `product_line` only flips to `lite` on a paid Lite invoice.

Because of this, **a trialing client must never be shown a plan price as though it were "their"
plan** — they haven't chosen one. Settings → Billing shows "Free with full Pro Access" plus two
comparable plan cards (Pro badged as what the trial already gives them, Lite beside it with what
it costs and what it gives up).

**Subscribing early:** the backend has always allowed it (`checkout` / `subscription-intent` do
not check trial status) — but the UI didn't offer it. Settings → Billing now links to
`/billing?subscribe=1`, which seeds `proceedEarly` and skips the early-trial soft landing.
Without that flag, `/billing` shows a "you're on a free trial, no payment needed yet" splash to
anyone with >3 days left, which is a dead end for someone who just clicked "subscribe now".

---

## Legacy Tier 1/2/3 model (SUPERSEDED — kept for unit-economics reference)

> Replaced by the Lite/Pro split above. The per-location cost analysis below still applies.

| Tier | Monthly Price | Included Locations | Additional Locations |
|---|---|---|---|
| Tier 1 — Starter | $350/mo | 1 | +$150/mo each |
| Tier 2 — Growth | $700/mo | 3 | +$100/mo each |
| Tier 3 — Scale | $1,200/mo | 5 | +$75/mo each |

All tiers include: daily ranking tracking, 6-hour review sync, citation monitoring, monthly PDF report.

---

## Our Costs Per Location

| Cost | Amount | Notes |
|---|---|---|
| BrightLocal Data API — rankings | ~$1.50/mo per location | 5 keywords × 2 engines × $0.005 × 30 days |
| BrightLocal Data API — citation audit | ~$0.075/mo per location | 15 directories × $0.005, run monthly |
| BrightLocal Data API — geo-grid | ~$0.245/run per location | 49 requests × $0.005, run monthly or on-demand |
| **BrightLocal Data API total** | **~$1.82/mo per location** | No subscription fee — pure pay-per-request |
| BrightLocal Management API | TBD | Citation submission to 40+ dirs; pending paid plan confirmation from BL support |
| EmbedMyReviews | $99/mo flat | All clients, all locations |

---

## Unit Economics Examples

### Tier 1 — 1 location
- Revenue: $350/mo
- BrightLocal Data API: ~$1.82
- EMR share: ~$10 (prorated)
- **Net: ~$338/mo (97% margin)**

### Tier 1 — 4 locations (1 included + 3 additional)
- Revenue: $350 + (3 × $150) = $800/mo
- BrightLocal Data API: 4 × $1.82 = ~$7.28
- EMR share: ~$15
- **Net: ~$778/mo (97% margin)**

### Tier 2 — 3 locations
- Revenue: $700/mo
- BrightLocal Data API: 3 × $1.82 = ~$5.46
- EMR share: ~$15
- **Net: ~$680/mo (97% margin)**

### 10 Clients at Tier 1 (1 location each)
- Revenue: 10 × $350 = $3,500/mo
- BrightLocal Data API: 10 × $1.82 = $18.20
- EMR: $99 flat
- **Net: ~$3,383/mo (97% margin)**

### 50 Clients at mixed tiers (avg $500/mo, avg 2 locations)
- Revenue: 50 × $500 = $25,000/mo
- BrightLocal Data API: 100 × $1.82 = $182
- EMR: $99 flat
- **Net: ~$24,719/mo (99% margin)**

---

## Stripe Implementation

### Products & Prices to Create
```
Product: SuperLocalSEO Tier 1
  Price: $350/mo recurring (base_location_price)
  Metadata: tier=1, included_locations=1

Product: SuperLocalSEO Tier 2
  Price: $700/mo recurring
  Metadata: tier=2, included_locations=3

Product: SuperLocalSEO Tier 3 — Scale
  Price: $1,200/mo recurring
  Metadata: tier=3, included_locations=5

Product: Additional Location — Tier 1
  Price: $150/mo recurring (per-unit, usage-based)

Product: Additional Location — Tier 2
  Price: $100/mo recurring

Product: Additional Location — Tier 3
  Price: $75/mo recurring
```

### Subscription Logic
- On client registration: create Stripe customer + subscription (Tier 1 default)
- On location add: create additional subscription item for that location's price ID
- On location remove: remove subscription item (prorated)
- Stripe handles prorations automatically

### Webhook Events to Handle
| Event | Action |
|---|---|
| `customer.subscription.created` | Activate client |
| `customer.subscription.updated` | Update tier, location count |
| `customer.subscription.deleted` | Deactivate client |
| `invoice.paid` | Clear past_due, log payment |
| `invoice.payment_failed` | Mark past_due, start 3-day grace |
| `invoice.payment_action_required` | Email client to update card |

### Grace Period
On `invoice.payment_failed`: set `subscription_status = 'past_due'`, send email, start 3-day timer. After 3 days without payment, set `subscription_status = 'suspended'`, block dashboard access but preserve data.
