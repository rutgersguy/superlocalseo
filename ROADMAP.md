# SuperLocalSEO — Roadmap

**Target:** 4–6 weeks to first paying client (Phase 1 MVP), 16 weeks to full production.

**Status (as of 2026-05-02):** Phase 0 ✅ · Phase 1 ✅ · Phase 2 (Reports) ✅ · Phase 3 (Analytics) ✅ · Phase 2+ Quick Wins ✅ · Revenue Multipliers ✅ · Phase 4 (Hardening) ✅ · All features complete — in active QA & polish

---

## Phase 0 — Infrastructure Foundation (Weeks 1–2) ✅

### Deliverables
- [x] Docker Compose (local dev): postgres, redis, api, web, nginx
- [x] Docker Compose (prod): same + Cloudflare SSL + n8n-nginx reverse proxy
- [x] PostgreSQL schema — 13 tables (see [Architecture](docs/ARCHITECTURE.md))
- [x] Knex.js migrations + seed data for development
- [x] Express server: middleware stack (auth, logging, rate limit, error handler)
- [x] Zod request validation on all endpoints
- [x] JWT auth (access token + refresh token, httpOnly cookie)
- [x] Stripe: products + prices for Tier 1/2/3, webhook handler, subscription lifecycle
- [x] `GET /health` liveness and readiness probes
- [x] Winston logging (JSON to stdout, structured)
- [x] GitHub Actions: TypeScript check + Jest (backend) + Vite build (frontend) on every push/PR
- [x] `.env.example` with all required variables documented

---

## Phase 1 — MVP: First Paying Client (Weeks 3–6) ✅

### Authentication
- [x] `POST /auth/register` — email + password + business name
- [x] `POST /auth/login` — returns JWT access + refresh tokens
- [x] `POST /auth/refresh` — silent token rotation
- [x] `POST /auth/logout` — invalidate refresh token in Redis
- [x] `POST /auth/forgot-password` + `POST /auth/reset-password`
- [x] Email verification via Resend
- [x] Role-based access: `admin`, `client`
- [x] Google OAuth — `GET /auth/google` + `GET /auth/google/callback` (sign-in/sign-up)

#### Stripe Billing (Day One)
- [x] Subscription creation on registration (Tier 1 default)
- [x] Per-location billing: base price + per-additional-location fee
- [x] Webhook handler: `invoice.paid`, `customer.subscription.deleted`, `payment_intent.payment_failed`
- [x] Billing portal (Stripe Customer Portal)
- [x] Grace period (3-day) on failed payments before access revoked
- [x] Plan upgrade / downgrade flow

#### Client Onboarding (4-Step Wizard)
- [x] Step 1: Business info (name, industry)
- [x] Step 2: Locations (address, phone, website per location)
- [x] Step 3: Target keywords (add/remove, assign to locations)
- [x] Step 4: Connect platforms (Google Business Profile OAuth; Yelp/Facebook coming soon)
- [x] Trigger initial data pull on completion

#### BrightLocal Integration (operator-level, pay-per-request Data API)
- [x] Data API service wrapper (`api.brightlocal.com`, `x-api-key` header, retry on 429)
- [x] Daily rankings pull via `POST /data/v1/rankings/search` (5 engines: google, google-mobile, google-local-finder, bing, bing-local) → stored in `ranking_snapshots`
- [x] Monthly citation audit via `POST /data/v1/listings/find` per directory → stored in `citation_snapshots` with NAP field-level accuracy
- [x] Geo-grid heatmap via coordinate-based ranking requests (7×7 or 13×13 grid) → stored in `geo_grid_reports`
- [x] In-house audit scoring: NAP score, citation score, ranking score, composite → stored in `location_audits`
- [x] Industry-aware directory targeting: `CORE_DIRECTORIES` + industry-specific extras (Health: healthgrades/zocdoc; Legal: avvo/justia/findlaw; etc.)
- [x] Industry-aware keyword seeding: 35 industries across 8 groups, keywords seeded on location create
- [x] Bull queue jobs: `brightlocal:rankings` (cron `0 6 * * *`), `brightlocal:citations` (monthly), `brightlocal:geogrid` (on-demand)
- [x] `GET /rankings` with filters (locationId, keywordId, searchEngine, rankType, pagination)
- [x] `GET /rankings/trend?keywordId=&locationId=&days=`
- [x] `POST /rankings/sync` — manual refresh with 24h cooldown
- [x] `GET /citations` — latest snapshot per directory per location
- [x] `GET /citations/history` — citation completeness over time
- [x] `POST /geo-grid` — trigger geo-grid scan; `GET /geo-grid/:id` — results with grid_data JSON
- [x] `GET /audits/bl` — audit history; `POST /audits/bl/generate` — trigger with 30-day cooldown
- **Note:** Management API (citation submission to 40+ directories) pending paid plan confirmation from BrightLocal support. See GitHub issue #77.

#### EmbedMyReviews Integration (operator-level)
- [x] API service wrapper
- [x] 6-hour review pull → stored in `reviews` table
- [x] Bull queue job: cron `0 */6 * * *`
- [x] Webhook handler: `POST /reviews/webhook` (real-time inbound, HMAC validated)
- [x] `GET /reviews` with platform/rating/status/search filters + pagination

#### Client-Facing Integrations
- [x] Google Business Profile OAuth connect/disconnect (Settings + Onboarding)
- [x] Google Business Profile data sync (reviews via GBP API v4, token auto-refresh)
- [x] Yelp — via BrightLocal reputation monitoring (Yelp removed direct API access 2018)
- [x] Facebook OAuth + page review sync (Graph API v19.0 ratings endpoint)

#### Dashboard Pages
- [x] **Home** — 4 metric cards + keyword summary table
- [x] **Rankings** — sortable keyword table, trend chart (30d/90d/All toggle), rank delta badges, CSV export
- [x] **Reviews** — review cards, filter by platform/rating/status/search, volume chart, sentiment trend chart, CSV export
- [x] **Citations** — directory grid with completeness score
- [x] **Reports** — report history, manual generate, download button
- [x] **Settings** — account, integrations (Google/Yelp/Facebook), billing

---

## Phase 2 — Monthly Reports (Weeks 7–9) ✅

### Deliverables
- [x] Report template (HTML → PDF via Puppeteer): branded, multi-section
- [x] Sections: executive summary, rankings table (delta vs prior month), reviews breakdown, citation completeness, recommendations
- [x] Bull job: `reports:generate-monthly` (cron `0 8 1 * *`)
- [x] Reports stored in DB + local file
- [x] Resend email: HTML email with PDF attachment
- [x] `GET /reports` — list all reports
- [x] `GET /reports/:id/download` — download PDF
- [x] Dashboard **Reports** page with history + download
- [x] Manual trigger endpoint: `POST /reports/generate`
- [x] Report preview in-browser (authenticated blob → object URL → iframe modal)

---

## Phase 3 — Historical Data & Analytics (Weeks 10–12) ✅

### Deliverables
- [x] `GET /analytics/rankings/history?from=&to=&keywordId=&locationId=` — arbitrary date range
- [x] `GET /analytics/reviews/trend?days=&from=&to=&platform=` — volume + sentiment series
- [x] `GET /analytics/export?type=rankings|reviews` — bulk CSV download
- [x] Rankings page: 30d / 90d / All time-range toggle on trend chart
- [x] Rankings page: position delta badges (▲3 / ▼1) vs prior snapshot
- [x] Reviews page: volume by platform stacked bar chart (30d/90d/180d toggle)
- [x] Reviews page: average rating trend line chart
- [x] Citation completeness over time chart (new /citations/history endpoint + LineChart)
- [x] Admin dashboard: cross-client analytics (signup/churn by month + tier breakdown charts)

---

## Phase 2+ — Advanced Features & Upsell (Weeks 10–16) 🔄

Features designed to increase ARPU from $780 → $1,025+ and reduce churn. See [Epic #67](https://github.com/rutgersguy/superlocalseo/issues/67) for financial projections.

### Quick Wins
- [x] **#68 Audit Report Lead Magnet** — free public `/audit` page, Google Places scan, 5-category score, email gate, register CTA
- [x] **#69 Team Members & RBAC** — invite admin/viewer users by email, 48hr token flow, instant login on accept, owner-only Team tab in Settings
- [x] **#70 Review Widgets** — embeddable `<script>` carousel with light/dark theme, per-widget config, live preview in Settings
- [x] **#71 Lead Attribution & ROI** — search volume per keyword, CTR-based revenue estimates, ROI config in Settings, Est. Revenue column in Rankings
- [x] **#65 Crisp chat widget** — in-app support (websiteId b43a3ca0, identity push on login)

### Revenue Multipliers (Phase 3+)
- [x] **#72 AI Review Responses** — Claude Haiku drafts per-review, client edits + approves + copies to platform; draft persists in DB
- [x] **#73 Review Request Campaigns** — built on EMR campaign API: contact upload → `POST /campaigns/{id}/invite` triggers EMR gating (4-5★→Google, 1-3★→private feedback); funnel metrics dashboard
- [x] **#74 Competitor Benchmarking** — full competitive intelligence suite: Google rating/review count via Places API (daily sync); SERP-based rank tracking via DataForSEO at zero extra cost (piggybacked on existing ranking calls); Keyword Battleground table (per-keyword × city, winning/losing/uncontested, sortable + filterable); Head-to-Head tab; Discover Keywords tab (DataForSEO Labs, up to 1000 keywords); Run Scan button with 24h Redis cooldown gate; `competitor_rankings` table with `geo_location` column
- [x] **#75 QR Codes & NFC Review Capture** — printable QR codes → Google review deep-link, scan count tracking, PNG download; QR Codes tab in Settings

### EMR Integration Foundation (prerequisite for #73)
- [x] **#76 EMR data model fixes** — add `replied`, `reply_date`, `emr_reply_text`, `hidden`, `avatar_url`, `verified` to reviews table; fix webhook to sync reply status on `review-updated`; expand `fetchReviews()` with pagination + filters; add `fetchCampaigns()` + `sendInvite()` to service

### Blocked on Google Business API Approval
- [ ] **Review Request Campaigns (full send flow)** — UI built; requires verified GBP OAuth app with `business.manage` scope
- [ ] **GBP review sync** — `syncGBPReviews()` implemented; blocked on same scope approval
- [ ] **SEO Audit GBP health score** — GBP data calls wired; blocked on scope approval

### Scale Plays (Phase 4+)
- [ ] White-label reseller program — agencies resell to clients
- [ ] Mobile app (iOS/Android with push notifications)

---

## DataForSEO Integration ✅

**Status:** Live. Credentials configured as `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD`.

### Implemented
- [x] `dataforseo.service.ts` — wrapper around DataForSEO SERP API (`/serp/google/organic/live/advanced`) for keyword rankings; Keywords Data API for search volume backfill; Labs API for competitor keyword discovery
- [x] **SERP-based rankings** — replaces BrightLocal for daily ranking pulls. Each call returns top 30 results; client and all tracked competitors are matched in the same response (zero extra cost for competitor tracking)
- [x] **Search volume backfill** — `getAggregatedSearchVolumes()` fetches `monthly_search_volume` for any keyword that has a null value at sync time; averaged across service-area geographies
- [x] **Competitor keyword discovery** — `getCompetitorRankedKeywords()` calls DataForSEO Labs `ranked_keywords/live` (US country code `2840`) returning up to 1 000 keywords sorted by search volume; filters out keywords the client already tracks
- [x] **Geo support** — ranking calls include primary city + up to 4 service-area cities per location; each snapshot tagged with `geo_location` for city-level competitive analysis

### API constraints discovered
- Labs `ranked_keywords/live` only accepts country-level location codes (`2840` for USA). DMA or state-level codes cause a `40501 Invalid Field` error.
- Labs `order_by` must be an array of strings in `"field,dir"` format. Nested arrays cause a `40501 Invalid Field` error.

### Future DataForSEO opportunities (not yet scoped)
- **On-Page API** — Core Web Vitals, schema markup, broken links → "Website Health" audit score
- **Google Business Profile API** — GBP categories, attributes, posts without OAuth → GBP health scoring
- **Backlinks API** — domain authority signal for audit reports
- **Local Pack API** — direct map pack extraction

---

## Phase 4 — Hardening & Scale (Weeks 13–16)

### Deliverables
- [x] Load tests (k6): `tests/k6/load-test.js` — 50 VU, p95 < 2s threshold
- [x] OWASP Top 10 security audit + remediation — open-redirect fix, AI rate limiter, body size limit, timing-safe HMAC comparison
- [x] Prometheus metrics: `GET /api/prom-metrics` (admin token) — request duration histogram, request counter, default Node.js metrics via prom-client
- [x] Sentry error tracking — `@sentry/node` backend + `@sentry/react` frontend, graceful no-op when SENTRY_DSN not set
- [x] Automated job failure alerting — email sent to operator inbox on any BullMQ worker failure
- [x] Regression test suite — access-control scoping, webhook HMAC security, rate-limiting, auth (10 tests passing)
- [x] Full Cypress E2E suite: `tests/cypress/e2e/critical-paths.cy.ts` — register → login → dashboard → reports → settings
- [x] Database backup automation — `scripts/backup-db.sh` (pg_dump, gzip, 30-day retention via cron)
- [x] Disaster recovery runbook — `docs/DISASTER_RECOVERY.md`
- [x] Go-live checklist: `docs/DEPLOY.md` — DNS, TLS, Stripe live mode, Resend domain auth, full smoke test steps

---

## Pricing Model

| Tier | Monthly | Included Locations | Additional Locations |
|---|---|---|---|
| Tier 1 | $350/mo | 1 | +$150/mo each |
| Tier 2 | $700/mo | 3 | +$100/mo each |
| Tier 3 | $1,200/mo | 5 | +$75/mo each |

**BrightLocal Data API cost per location:** ~$1.82/mo (pay-per-request, no subscription fee) · **EmbedMyReviews:** $99/mo flat

See [docs/PRICING.md](docs/PRICING.md) for full unit economics.

---

## Tech Decisions (Final)

| Decision | Choice | Rationale |
|---|---|---|
| Server state | SWR | Caching, revalidation, background refresh |
| Client state | React Context | Auth + UI state only; no Redux overhead |
| ORM | Knex.js only | Migrations + type-safe queries |
| Job queue | Bull | Cron + retry + priority queues |
| HTTP client | Native fetch / SWR | No Axios dependency |
| PDF | Puppeteer | Server-side HTML → PDF |
| Charts | Recharts | Composable, TypeScript-native |
| OAuth | Google OAuth 2.0 | Sign-in + Business Profile connect |
| Email | Resend | Transactional email (verification, reports) |

---

## Success Metrics

| Phase | Milestone |
|---|---|
| Phase 0 | All services healthy in Docker, tests passing in CI |
| Phase 1 | First paying client, card charged, dashboard live |
| Phase 2 | First automated monthly report delivered by email |
| Phase 3 | Client can view 90-day ranking trend + export data |
| Phase 2+ | Team members, widgets, and audit funnel live |
| Phase 4 | 50 concurrent users < 2s p95, OWASP audit passed |

---

## QA & Polish Log

### 2026-05-07
- **BrightLocal Data API migration** — migrated geo-grid, citation auditing, and audit scoring from Management API to Data API. Removed `brightlocal_campaign_id` requirement from all current features. Rankings were already on Data API; now geo-grid, citations, and scoring follow. See GitHub issues #74, #75, #76.
- **In-house audit scoring** — `audit_score.service.ts` computes NAP/citation/ranking/composite scores from our own DB data. No BrightLocal dependency for scoring.
- **Industry-specific directory targeting** — `getDirectoriesForIndustry()` returns curated directory list per industry group for citation auditing.
- **Citation guided workflow** — GitHub issue #77: `GET /citations/fix-suggestions` returns per-directory fix links (phase 2). Phase 1 citation auditing (checking, not submission) is live.
- **GitHub issues closed** — #72 (BrightLocal 500 error) closed; root cause was using Management API on free plan. Resolved by Data API migration.

### 2026-05-02
- **docs/FEATURES.md** — 2,100-line comprehensive reference covering all 30 feature areas added to repo
- **QA smoke test** — 45/45 checks passing; rate limiters disabled in dev so suite runs repeatedly without 429s; admin seed credentials set
- **react-leaflet** — downgraded from v5 → v4 (v5 requires React 19; Docker `npm ci` was failing)
- **Audit page frozen** — fixed response wrapper mismatch (`res.data.*` not `res.*`); added "Unlocking…" button state
- **APP_URL** — changed from `http://localhost:5173` → `https://superlocalseo.com`; Google OAuth callback now redirects to real domain instead of localhost
- **Google OAuth flow** — new Google signups routed to `/onboarding`; existing email accounts that sign in with Google get `google_id` linked + green "account linked" banner
- **Onboarding Step 1** — pre-fetches existing `businessName`/`industry` from server; now saves both fields to DB when clicking Next (previously never persisted)
- **Audit → Register pre-fill** — email + business name carried as query params to `/register`; user-typed name takes priority over Google Places name
- **Auth error messages** — `EMAIL_TAKEN` returns `hint: 'google'|'password'`; register page shows contextual banner with correct CTA; login page detects `USE_GOOGLE_LOGIN` for passwordless accounts; fixed `res.message` → `res.error.message` extraction bug (previously always showed "Registration failed")
