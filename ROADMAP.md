# SuperLocalSEO — Roadmap

**Target:** 4–6 weeks to first paying client (Phase 1 MVP), 16 weeks to full production.

**Status (as of 2026-05-01):** Phase 0 ✅ · Phase 1 ✅ · Phase 2 (Reports) ✅ · Phase 3 (Analytics) ✅ · Phase 2+ Quick Wins ✅ (#65 pending email) · Revenue Multipliers ✅ (#72–76 all done) · Phase 4 (Hardening) pending.

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
- [ ] GitHub Actions: lint (ESLint + Prettier), Jest tests, coverage report
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
- [ ] Grace period (3-day) on failed payments before access revoked
- [ ] Plan upgrade / downgrade flow

#### Client Onboarding (4-Step Wizard)
- [x] Step 1: Business info (name, industry)
- [x] Step 2: Locations (address, phone, website per location)
- [x] Step 3: Target keywords (add/remove, assign to locations)
- [x] Step 4: Connect platforms (Google Business Profile OAuth; Yelp/Facebook coming soon)
- [x] Trigger initial data pull on completion

#### BrightLocal Integration (operator-level, not client-facing)
- [x] API service wrapper (rate limiting, error handling, retry)
- [x] Daily rankings pull → stored in `ranking_snapshots` table
- [x] Daily citations pull → stored in `citation_snapshots` table
- [x] Bull queue job: `brightlocal:pull` (cron `0 6 * * *`)
- [x] `GET /rankings` with filters
- [x] `GET /rankings/trend?keywordId=&locationId=&days=`
- [x] `GET /citations`

#### EmbedMyReviews Integration (operator-level)
- [x] API service wrapper
- [x] 6-hour review pull → stored in `reviews` table
- [x] Bull queue job: cron `0 */6 * * *`
- [x] Webhook handler: `POST /reviews/webhook` (real-time inbound, HMAC validated)
- [x] `GET /reviews` with platform/rating/status/search filters + pagination

#### Client-Facing Integrations
- [x] Google Business Profile OAuth connect/disconnect (Settings + Onboarding)
- [ ] Google Business Profile data sync (reviews, Q&A, info)
- [ ] Yelp OAuth (coming soon)
- [ ] Facebook OAuth (coming soon)

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
- [ ] Report preview in-browser (embedded PDF viewer)

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
- [ ] Citation completeness over time chart
- [ ] Admin dashboard: cross-client analytics view

---

## Phase 2+ — Advanced Features & Upsell (Weeks 10–16) 🔄

Features designed to increase ARPU from $780 → $1,025+ and reduce churn. See [Epic #67](https://github.com/rutgersguy/superlocalseo/issues/67) for financial projections.

### Quick Wins
- [x] **#68 Audit Report Lead Magnet** — free public `/audit` page, Google Places scan, 5-category score, email gate, register CTA
- [x] **#69 Team Members & RBAC** — invite admin/viewer users by email, 48hr token flow, instant login on accept, owner-only Team tab in Settings
- [x] **#70 Review Widgets** — embeddable `<script>` carousel with light/dark theme, per-widget config, live preview in Settings
- [ ] **#71 Lead Attribution & ROI** — monthly search volume per keyword, CTR-based revenue estimates, ROI config in Settings, Est. Revenue column in Rankings
- [ ] **#65 Crisp chat widget** — in-app support

### Revenue Multipliers (Phase 3+)
- [x] **#72 AI Review Responses** — Claude Haiku drafts per-review, client edits + approves + copies to platform; draft persists in DB
- [x] **#73 Review Request Campaigns** — built on EMR campaign API: contact upload → `POST /campaigns/{id}/invite` triggers EMR gating (4-5★→Google, 1-3★→private feedback); funnel metrics dashboard
- [x] **#74 Competitor Benchmarking** — track named competitors' Google ratings/review counts via Places API; leaderboard + side-by-side comparison dashboard; daily sync job
- [x] **#75 QR Codes & NFC Review Capture** — printable QR codes → Google review deep-link, scan count tracking, PNG download; QR Codes tab in Settings

### EMR Integration Foundation (prerequisite for #73)
- [x] **#76 EMR data model fixes** — add `replied`, `reply_date`, `emr_reply_text`, `hidden`, `avatar_url`, `verified` to reviews table; fix webhook to sync reply status on `review-updated`; expand `fetchReviews()` with pagination + filters; add `fetchCampaigns()` + `sendInvite()` to service

### Scale Plays (Phase 4+)
- [ ] White-label reseller program — agencies resell to clients
- [ ] Mobile app (iOS/Android with push notifications)

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

**BrightLocal cost per location:** ~$21/mo · **EmbedMyReviews:** $99/mo flat

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
