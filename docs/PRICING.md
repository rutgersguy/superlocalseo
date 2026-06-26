# Pricing Model

## Current Tiers — Lite/Pro (implemented, PR #102/#103)

| Plan | Monthly | Setup | Locations | Scope |
|---|---|---|---|---|
| **Lite** | $99/mo | none | 1 only | Dashboard, Rankings (read-only), Reviews, Campaigns, Reports, Settings + a blurred Competitors upgrade teaser |
| **Pro** | $349/mo | $499 one-time | 1 (+$125/mo each) | Full suite: geo-grid heatmaps, citation auditing, competitor intelligence, SEO audits, team members, QR codes, analytics/CSV exports |

- All existing clients default to **Pro** (zero disruption). New signups choose at registration; **trials run as Pro** and the plan applies at checkout (`product_line` flips to `lite` only on a paid Lite invoice).
- **Lite→Pro upgrade** is self-serve and prorated, with the **$499 setup fee waived** (existing paying customer).
- Stripe prices (sandbox): Lite `STRIPE_LITE_BASE_PRICE_ID` ($99/mo) · Pro base $349/mo · setup $499 · additional location $125/mo. The flip is driven by the `invoice.payment_succeeded` webhook.
- Enforcement architecture: `config/planFeatures.ts` capability map + `requireProPlan`/`enforcePlanGate`. See [LITE_PRO_PROGRESS.md](LITE_PRO_PROGRESS.md).

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
