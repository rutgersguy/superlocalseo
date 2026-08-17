# SuperLocalSEO — API Gap Analysis & Implementation Tickets

**Last updated:** 2026-05-07  
**Scope:** BrightLocal Data API + Management API coverage vs. current implementation — post Data API migration

---

## Summary

| Provider | Gaps identified | HIGH | MEDIUM | LOW |
|---|---|---|---|---|
| BrightLocal | 15 | 5 | 7 | 3 |
| EmbedMyReviews | 10 | 3 | 5 | 2 |
| **Total** | **25** | **8** | **12** | **5** |

---

## API Architecture Decision (2026-05-07)

After discovering that our Simply Listings account (free plan) cannot access BrightLocal Management API features, and after a conversation with BrightLocal support (Harry), we migrated to a dual-API approach:

**Data API** (`api.brightlocal.com`) — pay-per-request, no subscription required:
- Rankings across 5 search engines ✅ Active
- Geo-grid via `geo_location.coordinates.lat/lng` ✅ Active (GitHub #74)
- Citation auditing per-directory via Listings API ✅ Active (GitHub #75)
- In-house audit scoring (NAP/citation/ranking/composite) ✅ Active (GitHub #76)

**Management API** (`tools.brightlocal.com`) — requires paid BrightLocal plan:
- Citation submission to 40-80+ directories — pending paid plan upgrade (GitHub #77)
- Everything else below that was previously marked as "requiring Management API" is now either (a) implemented via Data API, (b) deferred/irrelevant, or (c) still needs Management API for the specific paid feature

**Key insight:** ~85% of the features originally attributed to the Management API can be fully recreated using the Data API. The only genuine gap is citation *submission* (the Data API is read-only).

---

## Top 5 Highest-ROI Opportunities

### 1. Geo-Grid Competitive Ranking (BL-1)
Visual map showing where a client ranks #1 vs #10+ across neighborhoods. The most visually compelling local SEO deliverable that exists. Agencies charge separately for this. No tool in our pricing tier includes it.

### 2. Local Search Audit (BL-2)
Monthly health score (NAP consistency, citation count, review velocity, Google completeness). Upgrade the free `/audit` lead magnet into an ongoing tracked score — directly answers "am I improving?"

### 3. EMR Customer Provisioning (EMR-1)
Create per-client EMR sub-accounts via the agency API. Required for the agency/reseller plan. Current single-account approach doesn't scale past ~20 clients.

### 4. ~~Reputation Manager (BL-3)~~ — ❌ CANCELLED (2026-07-14)
**BrightLocal, in writing: "We don't support Review Response via API."**

Do not build this, and do not trust the existing code: `brightlocal.service.replyToReview()`
POSTs to `/v4/rf/reply` and is wired into `POST /api/reputation/reviews/:reviewId/reply`. That
endpoint is not a supported API. It has never fired in production only because no client has a
BrightLocal reputation campaign.

**Replies to Google go through EMR** — `POST /api/v1/reviews/{id}/reply`, which publishes live
with no approval step. See `INTEGRATIONS.md`.

### 5. Rank Type Splits (BL-5)
BL already returns `rank_type` (organic / local-pack / paid) in every response — we just don't store or display it. One-day fix that reveals whether a client is winning in the local-pack vs. organic, which is very different signal for SMBs.

---

## Revenue Impact Estimates

| Ticket | New MRR Potential | Mechanism |
|---|---|---|
| BL-1 Geo-Grid | +$50/location/mo | Premium "Visibility Maps" add-on |
| BL-2 Local Audit | Churn reduction ~5% | Stronger ROI visibility = lower cancellation |
| BL-3 Reputation Manager | Conversion lift | Removes #1 onboarding blocker |
| EMR-1 Provisioning | Unlocks agency tier | Target: $2,500–5,000/mo per agency account |
| EMR-2 Credits | Prevents silent failures | Reduces campaign churn from invisible limit hits |

---

---

# BrightLocal Tickets

---

## BL-1 — Geo-Grid Visibility Maps

**Status:** ✅ IMPLEMENTED via Data API (2026-05-07) — GitHub #74  
**Priority:** HIGH  
**Effort:** 3–4 weeks  
**Dependencies:** None

### What and why
Implemented via `geo_location.coordinates.lat/lng` in the Data API `POST /data/v1/rankings/search` endpoint — not BL's `/v4/gpw/*` Management API endpoints. A 7×7 or 13×13 grid of lat/lng points is generated centered on the business, each point submitted as a separate ranking request. Results are stored in `geo_grid_reports` with `grid_data` JSON. See `backend/src/controllers/geogrid.controller.ts` for the COMPLETE implementation.

### Schema
**Migration:** `20260501900000_geo_grid.ts`

```ts
// geo_grid_reports table
t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
t.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');
t.uuid('keyword_id').notNullable().references('id').inTable('keywords').onDelete('CASCADE');
t.string('bl_report_id', 255).nullable();
t.string('status', 50).notNullable().defaultTo('pending'); // pending|processing|complete|failed
t.integer('grid_size').notNullable().defaultTo(7);         // 7x7 or 13x13 grid
t.decimal('center_lat', 10, 7).nullable();
t.decimal('center_lng', 10, 7).nullable();
t.jsonb('grid_data').nullable();  // array of { lat, lng, rank, url }
t.timestamp('completed_at').nullable();
t.timestamps(true, true);
```

### Backend

**`backend/src/services/brightlocal.service.ts`** — add:
```ts
// POST /v4/gpw/create-report
createGeoGridReport(campaignId, keyword, lat, lng, gridSize): Promise<{ reportId: string }>

// GET /v4/gpw/get-report/{id}
pollGeoGridReport(reportId): Promise<{ status: 'processing'|'complete'|'failed', grid: GridPoint[] }>

interface GridPoint { lat: number; lng: number; rank: number | null; url: string | null; }
```

**`backend/src/controllers/geogrid.controller.ts`** — COMPLETE. Uses Data API coordinates approach.

**`backend/src/jobs/queue.ts`** — `brightlocal:geogrid` queue registered (on-demand).

### Frontend
**`frontend/src/pages/Rankings.tsx`** — add "Visibility Map" tab alongside the existing rankings table:
- Tab renders `<GeoGridPanel locationId keywordId />` component.
- `GeoGridPanel`: keyword selector (dropdown of client's keywords), "Run Scan" button that calls `POST /api/geo-grid`, then polls `GET /api/geo-grid/:id` every 10s until `status = complete`.
- Map renders with Leaflet (`react-leaflet` package). Each grid cell is a colored circle: green (#1–3), yellow (#4–10), orange (#11–20), red (#20+/not ranked). Tooltip shows exact rank on hover.
- Below map: average grid rank, % of cells in top 3, % in top 10.
- "Run New Scan" shows report history (date + avg rank).

### Acceptance Criteria
- [x] `POST /api/geo-grid` with valid keyword_id + location_id returns 202 with report id
- [x] Frontend map renders grid cells with correct color coding
- [x] Client A cannot access geo-grid reports from Client B
- [x] Location without lat/lng returns 422 with NO_COORDINATES

---

## BL-2 — Local Search Audit (Monthly Health Score)

**Status:** ✅ IMPLEMENTED with in-house scoring (2026-05-07) — GitHub #76  
**Priority:** HIGH  
**Effort:** 2 weeks  
**Dependencies:** None

### What and why
Implemented with in-house scoring from our own `citation_snapshots` and `ranking_snapshots` data — not BL's `/v4/lscu/*` Management API endpoints. `audit_score.service.ts` computes NAP score (30%), citation score (40%), ranking score (30%), and composite. `review_score` and `google_score` remain null until GBP API integration (GitHub #78) is complete. See `backend/src/services/audit_score.service.ts` for the COMPLETE implementation.

### Schema
**Migration:** `20260501910000_location_audits.ts`

```ts
// location_audits table
t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
t.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');
t.string('bl_report_id', 255).nullable();
t.string('status', 50).notNullable().defaultTo('pending');
t.decimal('nap_score', 5, 2).nullable();
t.decimal('citation_score', 5, 2).nullable();
t.decimal('review_score', 5, 2).nullable();
t.decimal('google_score', 5, 2).nullable();
t.decimal('composite_score', 5, 2).nullable();
t.jsonb('raw_data').nullable();         // full BL audit response
t.jsonb('recommendations').nullable();  // parsed action items from BL
t.timestamp('completed_at').nullable();
t.timestamps(true, true);
```

### Backend

**`backend/src/services/brightlocal.service.ts`** — add:
```ts
createAuditReport(campaignId: string): Promise<{ reportId: string }>
pollAuditReport(reportId: string): Promise<{
  status: 'processing'|'complete'|'failed';
  scores?: { nap: number; citations: number; reviews: number; google: number; composite: number };
  recommendations?: string[];
  raw?: unknown;
}>
```

**`backend/src/controllers/audit_bl.controller.ts`** — new file (note: `audit.controller.ts` already handles the public lead-magnet; this is a separate authenticated audit controller):
- `list(req, res)` — `GET /audits/bl` — returns location_audits for `req.clientId`, newest first, one per location.
- `trigger(req, res)` — `POST /audits/bl/generate` — creates BL audit report for a given `location_id`.
- `get(req, res)` — `GET /audits/bl/:id` — full audit including raw_data.

**`backend/src/jobs/audits.job.ts`** — new file:
- `processAudits(job)` — called monthly OR to poll pending reports.
- Monthly fan-out: enqueue one job per active client/location with a BL campaign.
- Poll: for rows with `status = 'processing'`, call `pollAuditReport` and update.

**`backend/src/jobs/queue.ts`** — add `auditsQueue` + `auditsWorker`, cron `0 9 1 * *` (monthly, 1 hour after reports job).

**`backend/src/routes/audits_bl.ts`** — mount at `/audits/bl` in `routes/index.ts`.

### Frontend
**`frontend/src/pages/Dashboard.tsx`** — replace the existing citation completeness card with a "Local SEO Score" card showing the composite score + delta vs. prior month.

**New `frontend/src/pages/AuditHistory.tsx`** (or section in existing Reports page):
- Score trend line chart (Recharts `LineChart`) — one line per score category, x-axis = months.
- Latest audit breakdown: five category scores shown as radial progress bars or a radar chart.
- Recommendations list: BL's action items as a checklist with icons.
- "Run Audit Now" button (calls `POST /api/audits/bl/generate`, disabled for 30 days after last run).

### Acceptance Criteria
- [x] Monthly cron triggers audit for all active locations (no campaign ID required)
- [x] Score history chart shows at least 3 months when data is available
- [x] Composite score delta (▲/▼ vs. prior month) visible on Home dashboard card
- [x] Manual trigger respects 30-day cooldown per location
- [x] `GET /api/audits/bl` scoped to requesting client

---

## BL-3 — ❌ CANCELLED — Reputation Manager (Respond to Google Reviews via BL)

> **CANCELLED 2026-07-14.** BrightLocal, in writing: **"We don't support Review Response via
> API."** This ticket cannot be built. Replies to Google go through **EMR**
> (`POST /api/v1/reviews/{id}/reply` — publishes live, no approval step).
>
> The existing `replyToReview()` → `/v4/rf/reply` path in `brightlocal.service.ts`, and the
> `POST /api/reputation/reviews/:reviewId/reply` route that calls it, are built on an
> unsupported API and must be removed or repointed at EMR. Everything below is retained only
> as a record of what was planned.

**Priority:** ~~HIGH~~ — cancelled  
**Effort:** ~~1.5 weeks~~  
**Dependencies:** Locations must have a BL campaign configured; requires paid BrightLocal Management API plan

**Note:** `replyToReview()` uses the Management API (`tools.brightlocal.com`) and requires a paid BrightLocal plan. The function exists in `brightlocal.service.ts` but is gated behind `brightlocal_campaign_id`. This feature remains in the backlog as-is until Management API access is confirmed.

### What and why
BrightLocal's `/v4/rf/*` (Reputation Manager) endpoints allow fetching and replying to Google reviews using BrightLocal's own GMB-authenticated connection — no per-client Google OAuth required. Currently, our review response feature (`#72`) uses Claude to draft replies but clients must manually copy them to Google. This closes the loop: clients can approve and post replies directly from the dashboard.

### Schema
No new tables. Extend `reviews` table via migration:
**Migration:** `20260501920000_bl_review_ids.ts`
```ts
// Add to reviews table:
t.string('bl_review_id', 255).nullable();   // BL's internal review ID for reply API
t.string('bl_reply_status', 50).nullable(); // 'pending'|'posted'|'failed'
t.timestamp('bl_reply_posted_at').nullable();
```

### Backend

**`backend/src/services/brightlocal.service.ts`** — add:
```ts
fetchReputationReviews(campaignId: string, opts?: { page?: number; status?: string }):
  Promise<{ reviews: BLReview[]; total: number }>

replyToReview(campaignId: string, blReviewId: string, replyText: string):
  Promise<{ success: boolean; replyId?: string }>

interface BLReview {
  blReviewId: string;
  platform: string;
  authorName: string;
  rating: number;
  body: string;
  reviewDate: string;
  replied: boolean;
  replyText?: string;
}
```

**`backend/src/controllers/reputation.controller.ts`** — new file:
- `reply(req, res)` — `POST /reputation/reviews/:reviewId/reply` — body: `{ replyText: string }`.
  1. Load review row; verify `client_id = req.clientId`.
  2. If `ai_draft` exists in `review_responses` and `replyText` is not provided, use draft.
  3. Look up `bl_review_id`; call `replyToReview()`.
  4. Update review: `bl_reply_status = 'posted'`, `bl_reply_posted_at = now()`, `replied = true`.
- `syncBLReviews(req, res)` — `POST /reputation/sync` — pulls BL reputation reviews, matches by `external_review_id`, updates `bl_review_id` for any unmatched rows. Run on-demand or weekly via job.

**`backend/src/routes/reputation.ts`** — mount at `/reputation` in `routes/index.ts`.

### Frontend
**`frontend/src/pages/Reviews.tsx`** — update review card actions:
- Add "Post Reply" button alongside existing "Copy Draft" button. Only visible if `bl_review_id` is present and `bl_reply_status != 'posted'`.
- Clicking "Post Reply" opens a modal with the AI draft pre-filled (editable), a character counter, and a "Post to Google" confirm button.
- After posting: card shows green "Posted" badge with timestamp. Button becomes "View Reply."
- "Sync BL Reviews" button in page header (calls `POST /api/reputation/sync`).

### Acceptance Criteria
- [ ] Reply posts to Google via BL API and updates `bl_reply_status = 'posted'`
- [ ] "Post Reply" button only appears on reviews with a valid `bl_review_id`
- [ ] Client cannot post reply on another client's review
- [ ] BL API error surfaces as a toast notification, not a crash
- [ ] AI draft flows into the reply modal automatically if one exists

---

## BL-4 — Citation Builder (Automated Directory Submissions)

**Status:** 🔄 PARTIAL — Part A (guided workflow) implemented; Part B (automated submission) pending Management API paid plan  
**Priority:** HIGH  
**Effort:** 2 weeks  
**Dependencies:** BL Citation Builder API access (requires paid BL plan)

### What and why
Two-part approach:
- **Part A:** `GET /citations/fix-suggestions` returns per-directory fix links with NAP diffs — ships as guided manual workflow (no BL plan needed). ✅ Implemented.
- **Part B:** Full automated submission via Management API citation builder (`/v4/cb/*`) — requires paid BL plan, pending pricing confirmation from Harry. 🔄 Pending.

Previously: BrightLocal's `/v4/cb/*` Citation Builder submits business info to 50+ directories and tracks submission status. This is a natural Tier 2+ upsell: "we don't just track your citations — we build them."

### Schema
**Migration:** `20260501930000_citation_submissions.ts`

```ts
// citation_submissions table
t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
t.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');
t.string('directory', 100).notNullable();
t.string('status', 50).notNullable().defaultTo('pending'); // pending|submitted|live|rejected|duplicate
t.string('bl_submission_id', 255).nullable();
t.string('listing_url', 2000).nullable();
t.text('rejection_reason').nullable();
t.timestamp('submitted_at').nullable();
t.timestamp('live_at').nullable();
t.timestamps(true, true);
t.unique(['location_id', 'directory']);
```

### Backend

**`backend/src/services/brightlocal.service.ts`** — add:
```ts
submitCitations(campaignId: string, directories: string[]): Promise<{ jobId: string }>
getCitationSubmissions(jobId: string): Promise<SubmissionStatus[]>

interface SubmissionStatus {
  directory: string;
  status: 'pending'|'submitted'|'live'|'rejected'|'duplicate';
  listingUrl?: string;
  rejectionReason?: string;
}
```

**`backend/src/controllers/citation.controller.ts`** — add to existing file:
- `submit(req, res)` — `POST /citations/submit` — body: `{ locationId, directories?: string[] }`. Defaults to submitting to all unlisted directories if `directories` not specified.
- `listSubmissions(req, res)` — `GET /citations/submissions?locationId=` — returns citation_submissions rows.
- Status poll job updates rows on BL callback.

**`backend/src/jobs/queue.ts`** — add `citationBuilderQueue`, cron-less (on-demand only). Poll job: `0 */4 * * *` to check status of in-flight submissions.

### Frontend
**`frontend/src/pages/Citations.tsx`** — add to existing page:
- "Submit Missing Citations" button in page header. Only visible for Tier 2+ clients.
- Opens modal: shows list of unlisted directories with checkboxes (pre-selected), "Submit Selected" CTA.
- After submission: new "Submissions" tab in Citations page showing per-directory status with color-coded badges (pending/submitted/live/rejected).
- "Live" count in the existing completeness score updates as submissions go live.

### Acceptance Criteria
- [ ] `POST /api/citations/submit` creates BL citation builder job and inserts submission rows
- [ ] Poll job updates statuses from BL every 4 hours
- [ ] Submission tab shows real-time status for each directory
- [ ] Gated behind subscription tier check (Tier 2+ only)
- [ ] Duplicate detection: if already listed, mark as `duplicate` not `submitted`

---

## BL-5 — Rank Type Splits (Organic / Local Pack / Paid)

**Priority:** MEDIUM  
**Effort:** 1 day  
**Dependencies:** None — BL already returns this field

### What and why
BrightLocal returns a `rank_type` field (`organic`, `local_pack`, `paid`) on every ranking result. We discard it. For SMBs, a #2 local-pack rank is far more actionable than a #15 organic rank — they're completely different signals. Currently we blend them in a single chart. This is a one-day fix that meaningfully improves the Rankings page.

### Schema
**Migration:** `20260501940000_ranking_rank_type.ts`
```ts
// ALTER ranking_snapshots — add column:
t.string('rank_type', 20).notNullable().defaultTo('organic');
// Backfill: UPDATE ranking_snapshots SET rank_type = 'organic' WHERE rank_type IS NULL
```

### Backend

**`backend/src/services/brightlocal.service.ts`** — update `BLRankingResult`:
```ts
interface BLRankingResult {
  keyword: string;
  rank: number | null;
  url: string | null;
  searchEngine: 'google' | 'bing';
  rankType: 'organic' | 'local_pack' | 'paid';  // NEW
}
```
Map `r.rank_type` in the existing `fetchRankings()` results map.

**`backend/src/jobs/rankings.job.ts`** — update INSERT to store `rank_type`.

**`backend/src/controllers/ranking.controller.ts`** — update `GET /rankings` query to accept optional `rankType` filter param.

**`backend/src/controllers/analytics.controller.ts`** — update `GET /analytics/rankings/history` to accept `rankType` filter.

### Frontend
**`frontend/src/pages/Rankings.tsx`**:
- Add a segmented button group above the trend chart: `All | Organic | Local Pack | Paid`.
- Selecting a type filters the chart series and the keyword table.
- "Local Pack" tab highlighted with a map-pin icon to signal its importance.
- Delta badges (▲▼) calculated within the same rank type (no cross-type comparison).

### Acceptance Criteria
- [ ] Migration adds `rank_type` column with `'organic'` default (no data loss)
- [ ] New rankings snapshots store the correct rank_type from BL
- [ ] Filtering by rank type updates both chart and table
- [ ] `GET /api/rankings?rankType=local_pack` returns only local-pack results

---

## BL-6 — Citation Audit Detail (Field-Level NAP Mismatch)

**Status:** ✅ IMPLEMENTED via Data API Listings (2026-05-07) — GitHub #75  
**Priority:** MEDIUM  
**Effort:** 3 days  
**Dependencies:** None

### What and why
Implemented via the Data API Listings endpoint (`POST /data/v1/listings/find`). The response returns `profile.nap.address`, `profile.nap.telephone`, `profile.title` — we compute name/address/phone match booleans and store them in `citation_snapshots`. All NAP detail columns (`nap_name_match`, `nap_address_match`, `nap_phone_match`, `listed_name`, `listed_address`, `listed_phone`) are now populated from Data API responses.

Previously: BrightLocal returns field-level NAP accuracy — was the listed name correct? Address? Phone number? This turns the Citations page from a scorecard into an actionable error list — clients can see exactly which directories have a wrong phone number and go fix it.

### Schema
**Migration:** `20260501950000_citation_nap_detail.ts`
```ts
// ALTER citation_snapshots — add columns:
t.boolean('nap_name_match').nullable();
t.boolean('nap_address_match').nullable();
t.boolean('nap_phone_match').nullable();
t.string('listed_name', 500).nullable();
t.string('listed_address', 500).nullable();
t.string('listed_phone', 100).nullable();
```

### Backend

**`backend/src/services/brightlocal.service.ts`** — update `BLCitationResult`:
```ts
interface BLCitationResult {
  directory: string;
  listed: boolean;
  napMatch: boolean;
  listingUrl: string | null;
  napDetail?: {                   // NEW
    nameMatch: boolean;
    addressMatch: boolean;
    phoneMatch: boolean;
    listedName?: string;
    listedAddress?: string;
    listedPhone?: string;
  };
}
```
Map from BL response `nap_detail` object in `fetchCitations()`.

**`backend/src/jobs/citations.job.ts`** — update INSERT to store new NAP detail columns.

### Frontend
**`frontend/src/pages/Citations.tsx`** — make each directory row expandable:
- Click a directory row to expand: shows three field-level rows (Name / Address / Phone) with green ✓ or red ✗ icons.
- If a field is wrong, show what BL found in that directory vs. what the client's canonical value is.
- Add filter: "Show errors only" toggle that hides perfect-match listings.
- Count of NAP errors in the page header ("12 citations have errors").

### Acceptance Criteria
- [ ] NAP detail fields stored on new citation snapshots (old rows remain null — no backfill needed)
- [ ] Expandable citation rows show per-field match status
- [ ] "Show errors only" filter works correctly
- [ ] Error count accurate in page header

---

## BL-7 — Google Business Profile Sync via BrightLocal

**Priority:** MEDIUM  
**Effort:** 1.5 weeks  
**Dependencies:** BL Reputation Manager access; location must have BL campaign

### What and why
**Rewritten 2026-07-13 — the previous version of this ticket was wrong on two counts.**

It claimed BrightLocal exposes `/v4/gbp/*` endpoints. **No such endpoints appear in BrightLocal's API reference** (https://apidocs.brightlocal.com/) and we could not verify them anywhere. Do not build against them.

The real product is **Active Sync / the Listings Management API** (https://www.brightlocal.com/listings-management/active-sync/), which writes business info — categories, hours, description, GBP attributes, NAP — to Google, Apple, Facebook, Bing, and Yelp, and alerts on/lets us reject Google suggested edits. It runs on BrightLocal's own approved Google project, so **it routes around our pending GBP API quota approval** (our `quota_limit_value: 0` never enters the picture, because we never call Google — BrightLocal does).

It does **not** remove the client Google OAuth step; the client grants BrightLocal access via a Google consent screen instead of ours.

**Also dropped from this ticket: GBP Q&A.** Google discontinued the My Business Q&A API on 2025-11-03 ("you can no longer read or post questions and answers using the API", https://developers.google.com/my-business/content/qanda/change-log) and is removing the public Q&A surface from Business Profiles. No vendor can do this. Do not build it.

**~~Open questions before committing~~ — ALL ANSWERED by BrightLocal 2026-07-14** (see the
"BrightLocal — answered" table in `INTEGRATIONS.md`): (1) GBP OAuth **can** be initiated via API,
so white-label UX is preserved; (2) the tier is **Manage** or Grow — take **Manage**, since Grow's
premium is review response and BrightLocal cannot post replies via API at all; (3) there are **no
per-request fees**, just the subscription, with a 300/min rate limit. What remains is a purchase
decision (~$109/mo at 10 locations), not a vendor question.

**The one question still outstanding (2026-08-17):** the **Data API** (`api.brightlocal.com/data/v1`)
returns `401 {"message":"Unauthorized."}` on every call, while the **Management API** on the same
host with the **same key** returns 200. A deliberately invalid key produces a byte-identical
response, and there are no rate-limit headers, so we cannot tell from outside whether the key
lacks Data API entitlement or a quota has been exhausted — issue #80 noted BrightLocal returns 401
rather than 429 for quota. This is what has left Citations serving 90-day-old data. See #149.

### Schema
**Migration:** `20260501960000_gbp_listings.ts`
```ts
// gbp_listings table
t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
t.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE').unique();
t.jsonb('categories').nullable();     // primary + additional categories
t.jsonb('hours').nullable();          // { monday: { open: '09:00', close: '17:00' }, ... }
t.jsonb('attributes').nullable();     // { wheelchair_accessible: true, ... }
t.text('description').nullable();
t.timestamp('last_synced_at').nullable();
t.timestamps(true, true);
```

### Backend

**`backend/src/services/brightlocal.service.ts`** — add:
```ts
fetchGbpListing(campaignId: string): Promise<GBPListing>
updateGbpListing(campaignId: string, data: Partial<GBPListing>): Promise<{ success: boolean }>

interface GBPListing {
  categories: string[];
  hours: Record<string, { open: string; close: string } | null>;
  attributes: Record<string, boolean | string>;
  description: string;
}
```

**`backend/src/controllers/gbp.controller.ts`** — new file:
- `get(req, res)` — `GET /integrations/gbp/listing?locationId=` — returns gbp_listings row for location.
- `sync(req, res)` — `POST /integrations/gbp/sync` — pulls from BL, upserts gbp_listings.
- `update(req, res)` — `PUT /integrations/gbp/listing` — body: partial GBPListing. Calls BL update + refreshes local row.

**`backend/src/routes/gbp.ts`** — mount at `/integrations/gbp`.

### Frontend
**`frontend/src/pages/Settings.tsx`** — add "Google Business Profile" sub-section inside the Integrations tab:
- "Sync from Google" button (calls `POST /api/integrations/gbp/sync`).
- Editable form: description textarea, categories multi-select, hours grid (day/open/close per row), attributes checkboxes.
- "Save to Google" button (calls `PUT /api/integrations/gbp/listing`).
- Last synced timestamp shown below the form.

### Acceptance Criteria
- [ ] Sync fetches GBP data and upserts gbp_listings
- [ ] Update posts changes to Google via BL API
- [ ] Location without a BL campaign shows a "BL not configured" message rather than erroring
- [ ] Hours grid validates open < close for each day

---

## BL-8 — Search Visibility Score (Single Headline KPI)

**Priority:** MEDIUM  
**Effort:** 4 days  
**Dependencies:** BL-2 recommended but not required (score can be computed locally too)

### What and why
Clients ask "am I improving?" We answer with rankings tables and charts. What we need is a single number they can watch go up — something like a credit score for local SEO visibility. BrightLocal's `/v4/svr/*` returns a pre-computed 0–100 visibility score, or we can compute our own composite from existing data (avg rank, citation completeness, review velocity). Either way, a headline KPI card on the Home dashboard is high-impact for retention.

### Schema
**Migration:** `20260501970000_visibility_scores.ts`
```ts
// visibility_scores table
t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
t.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');
t.decimal('score', 5, 2).notNullable();
t.jsonb('components').nullable(); // { rankings: 72, citations: 68, reviews: 85 }
t.string('source', 20).notNullable().defaultTo('computed'); // 'computed' | 'brightlocal'
t.date('date').notNullable();
t.timestamps(true, true);
t.unique(['location_id', 'date']);
```

### Backend

**`backend/src/services/brightlocal.service.ts`** — add (optional BL source):
```ts
fetchVisibilityScore(campaignId: string): Promise<{ score: number; components: Record<string, number> }>
```

**`backend/src/controllers/metric.controller.ts`** — update existing metrics controller:
- Add `visibility(req, res)` — `GET /metrics/visibility?locationId=&days=30` — returns score time series from `visibility_scores`.

**`backend/src/jobs/rankings.job.ts`** — after storing ranking snapshots, compute and upsert a `visibility_scores` row for the day:
```
rankingScore = 100 - clamp(avgRank - 1, 0, 99)
citationScore = (citedCount / totalDirectories) * 100
reviewScore = clamp((avgRating - 1) / 4 * 100, 0, 100)
composite = (rankingScore * 0.5) + (citationScore * 0.3) + (reviewScore * 0.2)
```

### Frontend
**`frontend/src/pages/Dashboard.tsx`** — replace or augment one of the 4 metric cards with "Visibility Score":
- Big number (e.g. "74") with a trend arrow vs. 30 days ago.
- Clicking the card opens a modal or expands inline: mini sparkline (30d), three component bars (Rankings / Citations / Reviews).

### Acceptance Criteria
- [ ] Visibility score computed and stored nightly after rankings job completes
- [ ] Home dashboard card shows current score + 30d delta
- [ ] Component breakdown available on drill-down
- [ ] `GET /api/metrics/visibility` scoped to requesting client

---

## BL-9 — Competitor Rankings via BrightLocal

**Priority:** MEDIUM  
**Effort:** 4 days  
**Dependencies:** BL-5 (rank type stored) recommended

### What and why
We already have a Competitors page (`#74`) that pulls Google ratings/review counts via Places API. BrightLocal separately exposes `/v4/rlseo/get-competitor-rankings` which returns keyword ranking positions for named competitor domains. Adding this to the Competitors page means clients can see not just "they have more reviews" but "they rank #2 for our target keyword and we rank #8."

### Schema
**Migration:** `20260501980000_competitor_rankings.ts`
```ts
// Add to competitors table:
t.string('bl_competitor_domain', 500).nullable(); // e.g. "competitor.com"
t.decimal('bl_avg_rank', 4, 1).nullable();
t.integer('bl_top3_keywords').nullable();
t.integer('bl_top10_keywords').nullable();
t.timestamp('bl_rankings_synced_at').nullable();
```

### Backend

**`backend/src/services/brightlocal.service.ts`** — add:
```ts
fetchCompetitorRankings(campaignId: string, competitorDomain: string):
  Promise<Array<{ keyword: string; rank: number | null; rankType: string }>>
```

**`backend/src/controllers/competitor.controller.ts`** — update `update()` to accept `bl_competitor_domain`. Update `list()` to include BL ranking fields.

**`backend/src/jobs/competitors.job.ts`** — update `processCompetitors()`: for each competitor with a `bl_competitor_domain`, call `fetchCompetitorRankings()` and compute avg rank + top3/top10 counts, update competitors row.

### Frontend
**`frontend/src/pages/Competitors.tsx`** — update competitor rows:
- Add "Avg Rank" column (number or "—" if no BL domain configured).
- Add "Top 10 Keywords" column.
- "Add Competitor" modal: new optional "Website / Domain" field that maps to `bl_competitor_domain`.
- In the leaderboard, tooltip on rank cell: "BrightLocal ranking data — keyword position average across all tracked keywords."

### Acceptance Criteria
- [ ] Competitors job fetches BL rankings when `bl_competitor_domain` is set
- [ ] `bl_avg_rank` and top counts update after nightly sync
- [ ] Competitors without a domain configured gracefully show "—" (not an error)
- [ ] Accepts partial domain (strips `https://`, `www.`) before sending to BL

---

## BL-10 — Citation Opportunity Finder (Whitespark)

**Priority:** MEDIUM  
**Effort:** 1 week  
**Dependencies:** None

### What and why
BrightLocal integrates with Whitespark's citation finder to identify directories where competitors are listed but the client isn't. This turns "you have 42 out of 80 citations" into "here are the 12 specific directories you're missing that your competitors already have." High actionability, easy to visualize.

### Schema
**Migration:** `20260501990000_citation_opportunities.ts`
```ts
// citation_opportunities table
t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
t.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');
t.string('directory', 100).notNullable();
t.integer('competitors_listed').notNullable().defaultTo(0);
t.integer('domain_authority').nullable();
t.boolean('recommended').notNullable().defaultTo(false);
t.timestamp('found_at').notNullable().defaultTo(knex.fn.now());
t.unique(['location_id', 'directory']);
```

### Backend

**`backend/src/services/brightlocal.service.ts`** — add:
```ts
fetchCitationOpportunities(campaignId: string):
  Promise<Array<{ directory: string; competitorsListed: number; domainAuthority?: number; recommended: boolean }>>
```

**`backend/src/controllers/citation.controller.ts`** — add `listOpportunities(req, res)` — `GET /citations/opportunities?locationId=`.

**`backend/src/jobs/queue.ts`** — add `citationOpportunitiesQueue`, weekly cron `0 10 * * 1`.

**`backend/src/jobs/citations.job.ts`** — add `fetchAndStoreOpportunities()` called from weekly job.

### Frontend
**`frontend/src/pages/Citations.tsx`** — add "Opportunities" tab:
- Table: Directory name, DA score, # competitors listed, Recommended badge.
- Sort by "competitors listed" desc by default.
- "Submit" button on each row (calls `POST /api/citations/submit` with that directory) — wires into BL-4 when implemented.
- Count badge on tab: "8 opportunities found."

### Acceptance Criteria
- [ ] Opportunity data refreshed weekly via cron
- [ ] `GET /api/citations/opportunities` scoped to client
- [ ] "Recommended" flag visible and filterable
- [ ] Empty state shows "No opportunities found — great citation coverage!"

---

## BL-11 — Full Rank History (Uncapped Date Range)

**Priority:** MEDIUM  
**Effort:** 1 day  
**Dependencies:** None — data already in DB

### What and why
The analytics endpoint `GET /analytics/rankings/history` currently has an implicit cap because BL snapshots only go back as far as our cron has been running (since we went live). The "All" toggle on the Rankings trend chart likely shows all available data, but it's worth verifying there's no hard-coded date cap in the query, and confirming the x-axis scales correctly to account for months of data. This ticket is mostly cleanup + a verification check.

### Backend
**`backend/src/controllers/analytics.controller.ts`** — audit `GET /analytics/rankings/history`:
- Confirm `from=` parameter, if omitted, defaults to the earliest snapshot for that keyword (not a fixed lookback).
- Remove any hard-coded `>= NOW() - INTERVAL '90 days'` floor.
- Add `from` default: `SELECT MIN(pulled_at) FROM ranking_snapshots WHERE keyword_id = $1`.

### Frontend
**`frontend/src/pages/Rankings.tsx`** — verify "All" toggle:
- Confirm `from` is omitted when "All" is selected (not set to 90 days ago).
- Add x-axis tick formatting that adapts to range: `MMM YYYY` for ranges > 60 days, `MMM D` for shorter.

### Acceptance Criteria
- [ ] "All" toggle fetches from earliest available snapshot for that keyword
- [ ] Query performance acceptable with 12+ months of snapshots (add index if needed)
- [ ] X-axis labels readable at all time ranges

---

## BL-12 — Per-Location Scan Frequency

**Priority:** LOW  
**Effort:** 3 days  
**Dependencies:** None

### What and why
Currently all locations share the same daily BL rankings cron. High-value clients on Tier 3 or agencies tracking competitive markets may want daily scans; new clients on Tier 1 may be fine with weekly to reduce BL API costs. This adds scan frequency as a per-location setting.

### Schema
**Migration:** `20260502000000_location_scan_frequency.ts`
```ts
// ALTER locations — add:
t.string('bl_scan_frequency', 20).notNullable().defaultTo('daily'); // daily|weekly|monthly
```

### Backend
- `PUT /locations/:id` — accept `bl_scan_frequency` in body.
- `backend/src/jobs/rankings.job.ts` — before pulling for each location, check `bl_scan_frequency`. For `weekly`: only pull if `day_of_week = 1` (Monday). For `monthly`: only pull on `day_of_month = 1`.

### Frontend
**`frontend/src/pages/Settings.tsx`** (or Location edit modal) — add "Scan Frequency" select (Daily / Weekly / Monthly) per location.

### Acceptance Criteria
- [ ] Weekly locations skipped on non-Monday runs
- [ ] Monthly locations skipped unless it's the 1st of the month
- [ ] Default remains `daily` for existing locations after migration

---

## BL-13 — Agency BrightLocal Client Provisioning

**Priority:** LOW  
**Effort:** 1 week  
**Dependencies:** EMR-1 (implement alongside for consistent agency architecture)

**Note:** Lower priority now that `brightlocal_campaign_id` is no longer required for any current feature. Still relevant if/when we upgrade to paid Management API plan for citation submission.

### What and why
All our locations currently sit under a single BrightLocal account (one operator API key). BL has a client management API (`/v4/clients`) that lets agencies create per-client sub-accounts. Required for the agency/reseller plan: each agency's end-client needs their own BL client ID so their ranking data is isolated at the provider level.

### Schema
**Migration:** `20260502010000_bl_client_id.ts`
```ts
// ALTER clients — add:
t.string('bl_client_id', 255).nullable();
```

### Backend

**`backend/src/services/brightlocal.service.ts`** — add:
```ts
createBLClient(businessName: string, email: string): Promise<{ clientId: string }>
deleteBLClient(blClientId: string): Promise<void>
```

**Onboarding** — update Step 2 completion handler in `client.controller.ts`: after locations are saved, call `createBLClient()` and store `bl_client_id` on the clients row.

**`backend/src/controllers/client.controller.ts`** — on client DELETE (admin action): call `deleteBLClient()` before removing the row.

### Acceptance Criteria
- [ ] New client created during onboarding gets a BL client ID
- [ ] `bl_client_id` used in all BL API calls instead of the operator-level default
- [ ] Graceful degradation if BL provisioning fails (log + continue onboarding, retry async)

---

## BL-14 — Real-Time Review Monitoring Alerts

**Priority:** LOW  
**Effort:** 3 days  
**Dependencies:** None

### What and why
Currently reviews are pulled every 6 hours via cron. BL's `/v4/rm/create-alert` can send a webhook when a new review arrives. Pairing this with our existing EMR webhook handler means clients get near-instant review notifications instead of waiting up to 6 hours.

### Backend

**`backend/src/services/brightlocal.service.ts`** — add:
```ts
createReviewAlert(campaignId: string, webhookUrl: string): Promise<{ alertId: string }>
deleteReviewAlert(alertId: string): Promise<void>
```

**`backend/src/routes/webhooks.ts`** — add `POST /webhooks/brightlocal/reviews` handler. Validate BL signature, parse incoming review, upsert into `reviews` table (same logic as EMR webhook but BL field mapping).

**`backend/src/controllers/integration.controller.ts`** — add `enableBLAlerts(req, res)` / `disableBLAlerts(req, res)` — registers/removes the BL alert pointing at `${config.publicUrl}/webhooks/brightlocal/reviews`.

Store `bl_alert_id` in the `integrations` table (provider = `brightlocal`).

### Frontend
**`frontend/src/pages/Settings.tsx`** → Integrations tab → BrightLocal section: "Instant Review Notifications" toggle.

### Acceptance Criteria
- [ ] BL webhook arrives and upserts review within 60 seconds
- [ ] Alert created on toggle-on; deleted on toggle-off
- [ ] Webhook validates BL signature before processing

---

## BL-15 — Google Business Profile Photo Management

**Priority:** LOW  
**Effort:** 1 week  
**Dependencies:** BL-7 (GBP sync via BL) recommended first

### What and why
GBP photos significantly impact local pack click-through rates. BL's `/v4/gbp/get-photos` and `/v4/gbp/upload-photo` let us manage photos without per-client Google OAuth. Low priority but a useful completeness feature for Tier 3.

### Schema
**Migration:** `20260502020000_gbp_photos.ts`
```ts
// gbp_photos table
t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
t.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');
t.string('bl_photo_id', 255).nullable();
t.string('url', 2000).notNullable();
t.string('category', 100).nullable(); // 'exterior'|'interior'|'team'|'product'|'food_and_drink'
t.boolean('is_profile').notNullable().defaultTo(false);
t.timestamp('uploaded_at').nullable();
t.timestamps(true, true);
```

### Backend

**`backend/src/services/brightlocal.service.ts`** — add:
```ts
fetchGbpPhotos(campaignId: string): Promise<GBPPhoto[]>
uploadGbpPhoto(campaignId: string, imageBuffer: Buffer, category: string): Promise<{ photoId: string; url: string }>
deleteGbpPhoto(campaignId: string, blPhotoId: string): Promise<void>
```

**`backend/src/controllers/gbp.controller.ts`** (from BL-7) — add:
- `listPhotos(req, res)` — `GET /integrations/gbp/photos?locationId=`
- `uploadPhoto(req, res)` — `POST /integrations/gbp/photos` — multipart/form-data, max 5MB, JPEG/PNG only
- `deletePhoto(req, res)` — `DELETE /integrations/gbp/photos/:id`

### Frontend
**`frontend/src/pages/Settings.tsx`** → Integrations → GBP section: photo grid, upload button (file picker), delete button on hover. Category label on each photo.

### Acceptance Criteria
- [ ] Upload validates file type (JPEG/PNG) and size (< 5MB) before sending to BL
- [ ] Delete removes from both BL and local DB
- [ ] Photo grid shows all synced photos with category labels

---

---

# EmbedMyReviews Tickets

---

## EMR-1 — Customer Provisioning (Multi-Tenant EMR Sub-Accounts)

**Priority:** HIGH  
**Status:** ✅ Implemented (2026-05-02) — with operator-key fallback  
**Effort:** 3 weeks  
**Dependencies:** Must be done before agency/reseller plan launch

### What and why
All clients currently share a single EMR operator account — their reviews are separated only by our `client_id` DB column. EMR's agency API lets you create per-client sub-accounts, each with their own credentials, review sources, widgets, and campaign quotas. This is the single most important architectural upgrade before going to 20+ clients or launching the agency plan. Without it, one misbehaving client can exhaust operator-level rate limits and affect everyone.

### Schema
**Migration:** `20260502030000_emr_customer_ids.ts`
```ts
// ALTER clients — add:
t.string('emr_customer_id', 255).nullable();
t.string('emr_api_key_encrypted', 500).nullable(); // per-client EMR API key, AES-256 encrypted

// ALTER integrations — add:
t.string('emr_customer_id', 255).nullable(); // denormalized for fast lookup
```

### Backend

**`backend/src/services/embedmyreviews.service.ts`** — add:
```ts
createCustomer(businessName: string, email: string, plan?: string): Promise<{ customerId: string; apiKey: string }>
getCustomer(customerId: string): Promise<EMRCustomer>
deleteCustomer(customerId: string): Promise<void>
suspendCustomer(customerId: string): Promise<void>

interface EMRCustomer {
  id: string; email: string; businessName: string; plan: string; status: string;
}
```

All existing EMR service methods (`fetchReviews`, `fetchCampaigns`, `sendInvite`, etc.) must accept an optional `apiKey?: string` parameter. When provided, use it instead of the operator key from config. This enables per-client authenticated calls.

**`backend/src/controllers/auth.controller.ts`** (onboarding completion) — after Step 4:
- Call `createCustomer(businessName, userEmail)`.
- Encrypt the returned `apiKey` with `encrypt()` from `utils/crypto.ts`.
- Store `emr_customer_id` + `emr_api_key_encrypted` on the clients row.

**`backend/src/controllers/client.controller.ts`** — on client delete (admin): call `deleteCustomer(emr_customer_id)` first.

**`backend/src/controllers/billing.controller.ts`** — on subscription cancellation: call `suspendCustomer()`.

Helper `getClientEMRKey(clientId)` — decrypt and return the per-client key; fall back to operator key if `emr_customer_id` is null (for existing clients during migration).

### Frontend
**`frontend/src/pages/Onboarding.tsx`** — Step 4: after platforms are connected, show a spinner "Setting up your review account…" while EMR provisioning completes. On failure: show retry button (non-fatal; provisioning can be retried later from Settings).

### Acceptance Criteria
- [x] New clients provisioned with their own EMR customer ID during onboarding
- [x] Per-client EMR API key encrypted at rest (`integrations.api_key_encrypted`, AES-256)
- [x] All EMR API calls use per-client key when available; fall back to operator key for legacy clients (`getClientEMRKey`)
- [x] Deleting a client cleans up their EMR sub-account (`deleteClientEMR`)
- [x] Onboarding completes successfully even if EMR provisioning fails — falls back to shared operator key and logs a warning
- [x] `/api/clients/retry-emr-provision` endpoint for manual retry from the dashboard

**Note:** The agency sub-account API (`POST /agency/customers`) is currently returning 404 from `api.embedmyreviews.com`. The fallback to the shared operator key is active for all new clients until the EMR API URL/credentials are corrected in `.env`. Check with EmbedMyReviews for the correct `EMBEDMYREVIEWS_API_KEY` and API base URL.

---

## EMR-2 — Credit Management (Review Request Quota Visibility)

**Priority:** HIGH  
**Effort:** 3 days  
**Dependencies:** EMR-1 (per-client keys) for accurate per-client credit balance

### What and why
Clients sending review request campaigns consume EMR SMS/email credits. Currently we have no visibility into credit balances. When a client runs out, campaigns silently stop sending — clients assume the feature is broken and churn. This is a cheap fix with high churn-prevention value.

### Backend

**`backend/src/services/embedmyreviews.service.ts`** — add:
```ts
getCredits(apiKey: string): Promise<{ email: number; sms: number; total: number }>
addCredits(customerId: string, amount: number): Promise<{ newBalance: number }>
```

**`backend/src/controllers/campaign.controller.ts`** — add `getCredits(req, res)`:
- `GET /campaigns/credits`
- Gets client's EMR API key, calls `getCredits()`, returns balance.
- Caches result for 15 min in Redis to avoid hammering EMR.

### Frontend
**`frontend/src/pages/Campaigns.tsx`** — header area:
- Credit balance badge: "📧 142 email · 📱 38 SMS."
- Warning banner when total < 50: "You're running low on review request credits. Contact support to add more."
- Badge turns red when total < 20.

### Acceptance Criteria
- [ ] `GET /api/campaigns/credits` returns live balance from EMR
- [ ] Low-credit warning banner appears at < 50 credits
- [ ] Balance refreshes on page load (SWR with 15-min deduplicate interval)
- [ ] Graceful display when EMR-1 not yet provisioned ("Credits unavailable")

---

## EMR-3 — Plan & Limit Sync (Gate Features by EMR Plan)

**Priority:** HIGH  
**Effort:** 4 days  
**Dependencies:** EMR-1

### What and why
EMR plans have limits: max widgets, max review sources, max campaign contacts. We currently have no idea what limits a client's EMR plan has, so we can't enforce them in our UI. Clients who hit plan limits get opaque EMR API errors that surface as confusing 500s in our interface.

### Schema
**Migration:** `20260502040000_emr_plan_config.ts`
```ts
// ALTER clients — add:
t.jsonb('emr_plan_limits').nullable();
// e.g. { "max_widgets": 3, "max_sources": 5, "max_campaigns": 2, "plan_name": "starter" }
t.timestamp('emr_plan_synced_at').nullable();
```

### Backend

**`backend/src/services/embedmyreviews.service.ts`** — add:
```ts
getCustomerPlan(customerId: string): Promise<{ planName: string; limits: Record<string, number> }>
```

**`backend/src/jobs/reviews.job.ts`** — after pulling reviews, also call `getCustomerPlan()` and update `emr_plan_limits` + `emr_plan_synced_at` on the clients row (non-fatal if fails).

**`backend/src/controllers/widget.controller.ts`** — before `create()`: check current widget count against `emr_plan_limits.max_widgets`. Return 422 with `PLAN_LIMIT_REACHED` if at limit.

**`backend/src/controllers/campaign.controller.ts`** — before `invite()` fan-out: check contact count against `emr_plan_limits.max_campaign_contacts` if defined.

### Frontend
**`frontend/src/pages/Settings.tsx`** — Widgets tab: if at widget limit, "Add Widget" button is disabled with tooltip "You've reached your plan limit (3 widgets). Upgrade to add more."

**`frontend/src/pages/Campaigns.tsx`** — show plan name badge (e.g. "EMR Starter plan") next to credit balance. Link to upgrade path.

### Acceptance Criteria
- [ ] `emr_plan_limits` synced daily during reviews job
- [ ] Widget create blocked at plan limit with clear UI message
- [ ] `PLAN_LIMIT_REACHED` API error returns 422 with human-readable message
- [ ] Limits display correctly even when EMR returns extra unknown fields (use `?.` access)

---

## EMR-4 — Review Source Management (Connect Platforms via Dashboard)

**Priority:** MEDIUM  
**Effort:** 1 week  
**Dependencies:** EMR-1

### What and why
To connect Google, Yelp, Facebook, TripAdvisor etc. to EMR, clients currently must log into the EMR dashboard directly. EMR has a sources API that lets us surface this in our own Settings → Integrations tab. This reduces support tickets and makes onboarding more self-serve.

### Backend

**`backend/src/services/embedmyreviews.service.ts`** — add:
```ts
getSources(apiKey: string): Promise<EMRSource[]>
addSource(apiKey: string, platform: string, locationId?: string): Promise<{ sourceId: string; connectUrl: string }>
removeSource(apiKey: string, sourceId: string): Promise<void>

interface EMRSource {
  id: string; platform: string; status: 'connected'|'pending'|'error'; locationId?: string;
}
```

**`backend/src/controllers/integration.controller.ts`** — add:
- `listReviewSources(req, res)` — `GET /integrations/review-sources`
- `addReviewSource(req, res)` — `POST /integrations/review-sources` — body: `{ platform, locationId? }`. Returns a `connectUrl` if the platform requires OAuth; otherwise connects directly.
- `removeReviewSource(req, res)` — `DELETE /integrations/review-sources/:sourceId`

### Frontend
**`frontend/src/pages/Settings.tsx`** → Integrations tab: new "Review Sources" section.
- List of connected sources with status badges.
- "Add Platform" dropdown (Google, Yelp, Facebook, TripAdvisor, etc.).
- For platforms requiring OAuth: "Connect" button opens `connectUrl` in a new tab with a "I've connected it" confirm.
- Delete button with confirmation: "This will stop pulling reviews from this source."

### Acceptance Criteria
- [ ] Connected sources listed with correct status
- [ ] Platform with OAuth flow returns connectUrl; platform with direct connection connects immediately
- [ ] Removing a source stops future review pulls from that platform (EMR-side)
- [ ] Only admin/owner role can add or remove sources

---

## EMR-5 — Widget Advanced Configuration (Filters & Styling)

**Priority:** MEDIUM  
**Effort:** 4 days  
**Dependencies:** None (widgets already exist)

### What and why
The existing widget feature (`#70`) lets clients create and delete widgets and configure basic light/dark theme. EMR's widget config API exposes min-rating filters, platform filters, keyword filters, and custom CSS. Currently we give clients a widget embed code they can't customize further without going to EMR directly.

### Backend

**`backend/src/services/embedmyreviews.service.ts`** — add:
```ts
getWidgetConfig(widgetId: string): Promise<WidgetConfig>
updateWidgetConfig(widgetId: string, config: Partial<WidgetConfig>): Promise<void>

interface WidgetConfig {
  minRating?: number;          // 1-5
  platforms?: string[];        // ['google', 'yelp']
  keywordFilter?: string;      // show reviews containing this word
  customCss?: string;
  reviewCount?: number;        // max reviews to show
  sortBy?: 'newest'|'highest'|'lowest';
}
```

**`backend/src/controllers/widget.controller.ts`** — add:
- `getConfig(req, res)` — `GET /widget/:id/config`
- `updateConfig(req, res)` — `PUT /widget/:id/config` — validates `customCss` length (< 10,000 chars), sanitizes with a CSS allowlist (no `@import`, no `url(javascript:)` etc.)

### Frontend
**`frontend/src/pages/Settings.tsx`** → Widgets tab — expand each widget card to show an "Advanced" section:
- Min rating slider (1–5 stars).
- Platform checkboxes.
- Keyword filter text input.
- Custom CSS textarea (monospace font, 200px height).
- Sort order select.
- "Save Config" button — optimistic update via SWR mutate.
- Live preview iframe updates on save.

### Acceptance Criteria
- [ ] Config saved to EMR and confirmed 200 before showing success toast
- [ ] Custom CSS sanitized server-side (reject `@import`, `url(javascript:)`, `expression(`)
- [ ] Config inputs disabled and show spinner while save is in flight
- [ ] Widget preview updates after config save without full page reload

---

## EMR-6 — Campaign Templates

**Priority:** MEDIUM  
**Effort:** 3 days  
**Dependencies:** None (campaigns already exist)

### What and why
Clients setting up their first review request campaign face a blank form. EMR offers pre-built campaign templates (post-purchase, post-service, follow-up, general). Surfacing these reduces setup friction and increases campaign creation rates, which directly drives review volume.

### Backend

**`backend/src/services/embedmyreviews.service.ts`** — add:
```ts
getCampaignTemplates(): Promise<EMRTemplate[]>
createCampaignFromTemplate(apiKey: string, templateId: string, name: string): Promise<{ campaignId: string }>

interface EMRTemplate {
  id: string; name: string; description: string; type: string;
  defaultMessage?: string; sampleSubject?: string;
}
```

**`backend/src/controllers/campaign.controller.ts`** — add:
- `listTemplates(req, res)` — `GET /campaigns/templates` — fetches from EMR, cached for 24h in Redis.
- Update `create(req, res)` to accept optional `template_id` in body; if provided, calls `createCampaignFromTemplate()` instead of `createCampaign()`.

### Frontend
**`frontend/src/pages/Campaigns.tsx`** — "New Campaign" flow:
- Step 1: template picker — grid of template cards (post-purchase, post-service, follow-up, custom). Each card shows name + description.
- "Custom" option skips to the existing blank form.
- Selecting a template pre-fills the campaign name and populates a message preview.
- Step 2: review/edit name, then create.

### Acceptance Criteria
- [ ] Templates fetched from EMR and cached (not fetched on every page load)
- [ ] Selecting a template pre-fills the campaign name in the create form
- [ ] "Custom" option creates a blank campaign as before (no regression)

---

## EMR-7 — Unsubscribe Management

**Priority:** MEDIUM  
**Effort:** 2 days  
**Dependencies:** None

### What and why
Contacts who opt out of review request campaigns are tracked by EMR. We currently don't pull or display this list. Consequences: (1) clients don't know who has opted out; (2) clients may try to re-invite opted-out contacts, which violates CAN-SPAM/TCPA. Surfacing the unsubscribe list is a compliance and trust feature.

### Backend

**`backend/src/services/embedmyreviews.service.ts`** — add:
```ts
getUnsubscribes(apiKey: string, opts?: { page?: number }): Promise<{ contacts: UnsubscribeRecord[]; total: number }>

interface UnsubscribeRecord {
  contact: string;       // email or phone
  type: 'email'|'sms';
  unsubscribedAt: string;
}
```

**`backend/src/controllers/campaign.controller.ts`** — add `listUnsubscribes(req, res)`:
- `GET /campaigns/unsubscribes?page=1`
- Passes through to EMR using client's API key.

**Client-side guard in `invite()` and `bulkInvite()`**: before sending, check if the contact's email/phone is in the unsubscribe list. If so, skip with `status: 'skipped_unsubscribed'` in the bulk result.

### Frontend
**`frontend/src/pages/Campaigns.tsx`** — add "Unsubscribed" tab:
- Table: contact (masked: `j***@gmail.com`), type (Email/SMS), date.
- Count badge on tab.
- Bulk invite form: show warning if any contacts in the upload match known unsubscribes (checked client-side before submitting).

### Acceptance Criteria
- [ ] `GET /api/campaigns/unsubscribes` returns paginated list
- [ ] Bulk invite skips unsubscribed contacts automatically
- [ ] Unsubscribed contacts masked in display (privacy)
- [ ] Count badge on tab updates on data load

---

## EMR-8 — EMR Pre-Aggregated Review Analytics

**Priority:** MEDIUM  
**Effort:** 3 days  
**Dependencies:** EMR-1 (per-client keys for accurate data)

### What and why
We currently aggregate review analytics ourselves from the `reviews` table. For new clients with few reviews, our charts are sparse. EMR's analytics endpoint returns pre-aggregated volume + rating distributions going back further than our own data (since before the client joined our platform). Using EMR as a secondary data source enriches early-stage dashboards and reduces load on our own DB for large-volume clients.

### Backend

**`backend/src/services/embedmyreviews.service.ts`** — add:
```ts
getAnalytics(apiKey: string, opts: { from?: string; to?: string; platform?: string }):
  Promise<{ volumeByDay: Array<{ date: string; count: number }>; avgRating: number; ratingDistribution: Record<number, number> }>
```

**`backend/src/controllers/analytics.controller.ts`** — update `GET /analytics/reviews/trend`:
- If our own DB has < 10 reviews for the requested range, fetch from EMR as fallback.
- Merge data: prefer our DB data (has sentiment, status) and use EMR only to fill volume gaps.
- Add `source: 'db'|'emr'|'merged'` field to response for transparency.

### Frontend
No visible change needed. If a newly-registered client opens the Reviews chart, it shows historical data rather than a flat empty state. Add a subtle "Data sourced from connected review platforms" footnote when `source = 'emr'`.

### Acceptance Criteria
- [ ] New clients with < 10 DB reviews see EMR historical data in the trend chart
- [ ] Clients with abundant DB data see no change (our data takes precedence)
- [ ] EMR API failure on this path is non-fatal (graceful fallback to empty chart)

---

## EMR-9 — Private Feedback Inbox (1–3★ Campaign Responses)

**Priority:** LOW  
**Effort:** 3 days  
**Dependencies:** `#73` Review Request Campaigns (already built)

### What and why
The review gating flow routes 1–3★ respondents to a private feedback form instead of Google. This was the whole point of the campaign gating feature. But we never pull or display that private feedback — it's collecting in EMR and our clients can't see it without logging into EMR directly. This is a quick win that makes the campaign feature feel complete.

### Schema
**Migration:** `20260502050000_private_feedback.ts`
```ts
// private_feedback table
t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
t.string('emr_feedback_id', 255).notNullable().unique();
t.string('campaign_id', 255).nullable();
t.string('contact_name', 255).nullable();
t.string('contact_email', 255).nullable();
t.string('contact_phone', 100).nullable();
t.integer('rating').nullable();
t.text('message').nullable();
t.timestamp('received_at').notNullable();
t.timestamps(true, true);
```

### Backend

**`backend/src/services/embedmyreviews.service.ts`** — add:
```ts
fetchFeedback(apiKey: string, opts?: { page?: number; campaignId?: string }):
  Promise<{ feedback: EMRFeedback[]; total: number }>

interface EMRFeedback {
  id: string; contactName?: string; contactEmail?: string; contactPhone?: string;
  rating?: number; message?: string; campaignId?: string; receivedAt: string;
}
```

**`backend/src/jobs/reviews.job.ts`** — add `fetchAndStoreFeedback()` at end of job run:
- Fetches feedback since last pull, upserts to `private_feedback`.

**`backend/src/controllers/review.controller.ts`** — add `listFeedback(req, res)`:
- `GET /reviews/feedback?page=&campaignId=`

**`backend/src/routes/reviews.ts`** — add route.

### Frontend
**`frontend/src/pages/Reviews.tsx`** — add "Private Feedback" tab:
- Cards similar to review cards but with a "Private" label and no platform icon.
- Shows rating (star display), message, contact name (masked if email: `J*** S***`), campaign name.
- Filter by campaign (dropdown).
- Count badge on tab.
- Empty state: "No private feedback yet. Private feedback is captured when a review requester rates 1–3★."

### Acceptance Criteria
- [ ] Feedback pulled every 6 hours (same cadence as reviews job)
- [ ] `GET /api/reviews/feedback` scoped to client
- [ ] Contact info masked in display (show first initial + last initial)
- [ ] Empty state message explains what private feedback is

---

## EMR-10 — Review Flagging / Spam Reporting

**Priority:** LOW  
**Effort:** 2 days  
**Dependencies:** None

### What and why
Clients encounter fake or defamatory reviews and have no way to flag them from our dashboard. EMR's `/reviews/{id}/report` endpoint lets us submit a flag to the platform. Low ROI for most clients but important for Tier 3 clients managing many locations.

### Backend

**`backend/src/services/embedmyreviews.service.ts`** — add:
```ts
flagReview(apiKey: string, emrReviewId: string, reason: 'spam'|'fake'|'inappropriate'|'off_topic'): Promise<void>
```

**`backend/src/controllers/review.controller.ts`** — add `flag(req, res)`:
- `POST /reviews/:id/flag` — body: `{ reason: string }`.
- Validate reason is one of the four allowed values (Zod enum).
- Look up `external_review_id`; call `flagReview()`.
- Update reviews row: add `flagged_at` timestamp, `flag_reason` string.

**Migration:** `20260502060000_review_flags.ts`
```ts
// ALTER reviews — add:
t.timestamp('flagged_at').nullable();
t.string('flag_reason', 50).nullable();
```

### Frontend
**`frontend/src/pages/Reviews.tsx`** — review card kebab menu (⋮):
- Add "Flag as Spam / Inappropriate" option.
- Opens confirmation modal: "Flag this review?" with reason selector (Spam / Fake / Inappropriate / Off Topic) and "Flag Review" button.
- After flagging: card shows a small "Flagged" badge; button changes to "Flagged ✓."

### Acceptance Criteria
- [ ] `POST /api/reviews/:id/flag` with valid reason returns 200
- [ ] Invalid reason returns 422 from Zod validation
- [ ] Flagged review shows "Flagged" badge on card
- [ ] Client cannot flag reviews belonging to another client

---

---

# Implementation Order

## Phase 0 — Completed in Data API Migration (2026-05-07)
| Ticket | Status |
|---|---|
| BL-1 Geo-Grid | ✅ Implemented via Data API coordinates |
| BL-2 Local Search Audit | ✅ Implemented with in-house scoring |
| BL-4 Citation Builder Part A | ✅ Guided workflow with fix links |
| BL-5 Rank Type Splits | ✅ Already implemented |
| BL-6 Citation NAP Detail | ✅ Implemented via Listings Data API |

## Phase A — Quick Wins (< 1 week total)
| Ticket | Why now |
|---|---|
| BL-11 Rank History Uncap | 1 day; query-only change; removes silent limitation |
| EMR-7 Unsubscribe Management | 2 days; compliance risk mitigation |
| EMR-9 Private Feedback Inbox | 3 days; completes existing campaign feature |

## Phase B — High-Value Medium Sprints (1–2 weeks each)
| Ticket | Why |
|---|---|
| EMR-2 Credit Management | Prevents silent churn from campaigns failing |
| BL-8 Visibility Score | Single retention KPI for Home dashboard |
| EMR-5 Widget Advanced Config | Reduces Settings → EMR support tickets |
| EMR-6 Campaign Templates | Reduces campaign setup friction |

## Phase C — Major Features (2–4 weeks each)
| Ticket | Status/Why |
|---|---|
| BL-1 Geo-Grid | ✅ Done (Data API) |
| BL-2 Local Search Audit | ✅ Done (in-house scoring) |
| BL-3 Reputation Manager (Google Reply) | Closes review response loop; requires paid Management API plan |
| BL-4 Citation Builder | 🔄 Part A done; Part B pending paid plan |
| EMR-4 Review Source Management | Self-serve platform connections |

## Phase D — Agency Architecture (prerequisite for reseller plan)
| Ticket | Why |
|---|---|
| EMR-1 Customer Provisioning | Foundation for multi-tenant, must come first |
| EMR-3 Plan & Limit Sync | Requires EMR-1 |
| BL-13 BL Client Provisioning | Parallel to EMR-1; same architectural concern |

## Phase E — Remaining
BL-7, BL-9, BL-10, BL-12, BL-14, BL-15, EMR-8, EMR-10 — implement opportunistically or per client demand.
