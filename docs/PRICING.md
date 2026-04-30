# Pricing Model

## Client-Facing Tiers

| Tier | Monthly Price | Included Locations | Additional Locations |
|---|---|---|---|
| Tier 1 — Starter | $350/mo | 1 | +$150/mo each |
| Tier 2 — Growth | $700/mo | 3 | +$100/mo each |
| Tier 3 — Pro | $1,200/mo | 5 | +$75/mo each |

All tiers include: daily ranking tracking, 6-hour review sync, citation monitoring, monthly PDF report.

---

## Our Costs Per Location

| Cost | Amount | Notes |
|---|---|---|
| BrightLocal rankings | Included in plan | Growth plan $45/mo covers unlimited campaigns |
| BrightLocal reviews pull | $6/mo per location | $0.05/pull × 4 pulls/day × 30 days |
| BrightLocal citations pull | $15/mo per location | $0.05/source × 10 sources × 30 days |
| **BrightLocal total** | **$21/mo per location** | |
| EmbedMyReviews | $99/mo flat | All clients, all locations |

**BrightLocal plan base:** $45/mo (fixed, covers the Growth plan regardless of client count)

---

## Unit Economics Examples

### Tier 1 — 1 location
- Revenue: $350/mo
- BrightLocal: $21 + $45 plan = $66
- EMR share: ~$10 (prorated)
- **Net: ~$274/mo (78% margin)**

### Tier 1 — 1 client, 3 additional locations (4 total)
- Revenue: $350 + (3 × $150) = $800/mo
- BrightLocal: 4 × $21 + $45 = $129
- EMR share: ~$15
- **Net: ~$656/mo (82% margin)**

### Tier 2 — 3 locations included
- Revenue: $700/mo
- BrightLocal: 3 × $21 + $45 = $108
- EMR share: ~$15
- **Net: ~$577/mo (82% margin)**

### 10 Clients at Tier 1 (1 location each)
- Revenue: 10 × $350 = $3,500/mo
- BrightLocal: 10 × $21 + $45 = $255
- EMR: $99 flat
- **Net: ~$3,146/mo (90% margin)**

### 50 Clients at mixed tiers (avg $500/mo, avg 2 locations)
- Revenue: 50 × $500 = $25,000/mo
- BrightLocal: 100 × $21 + $45 = $2,145
- EMR: $99 flat
- **Net: ~$22,756/mo (91% margin)**

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

Product: SuperLocalSEO Tier 3
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
