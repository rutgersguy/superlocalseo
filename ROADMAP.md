# SuperLocalSEO — Roadmap

**Target:** 4–6 weeks to first paying client (Phase 1 MVP), 16 weeks to full production.

**Status (as of 2026-04-30):** Phase 0 complete. Phase 1 complete. Phase 2 complete. Phase 3 in progress.

---

## Phase 0 — Infrastructure Foundation (Weeks 1–2)

Get the scaffolding right so every subsequent phase builds cleanly.

### Goals
- Docker Compose running all services locally (Postgres, Redis, API, Web, Nginx)
- PostgreSQL schema deployed and migration tooling in place
- Express API scaffold with auth middleware, error handling, logging, rate limiting
- Stripe subscription billing wired up (day-one requirement)
- GitHub Actions CI: lint + test on every push
- Health check endpoints for liveness/readiness probes

### Deliverables
- [x] Docker Compose (local dev): postgres, redis, api, web, nginx
- [x] Docker Compose (prod): same + Cloudflare SSL + n8n-nginx reverse proxy
- [x] PostgreSQL schema — 12 tables (see [Architecture](docs/ARCHITECTURE.md))
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

## Phase 1 — MVP: First Paying Client (Weeks 3–6)

Build everything needed to onboard a real client and collect payment.

### Goals
- Public landing page converts visitors to trials
- Clients can sign up, connect their data sources, and see their dashboard
- Stripe billing collects money from day one
- BrightLocal pulling rankings and citations daily
- EmbedMyReviews pulling reviews every 6 hours
- Historical data stored from the first pull (BrightLocal has no history)

### Deliverables

#### Landing Page
- [x] Hero section (headline, CTA, social proof)
- [x] Value proposition cards (rankings, reviews, citations)
- [x] Pricing table (Tier 1–3 with per-location pricing)
- [x] FAQ (6 questions)
- [x] Footer
- [ ] SEO: meta tags, Open Graph, JSON-LD schema markup
- [x] Mobile responsive (320px–1440px)
- [ ] Lighthouse > 90 performance, > 95 accessibility

#### Authentication
- [x] `POST /auth/register` — email + password + business name
- [x] `POST /auth/login` — returns JWT access + refresh tokens
- [x] `POST /auth/refresh` — silent token rotation
- [x] `POST /auth/logout` — invalidate refresh token in Redis
- [x] `POST /auth/forgot-password` + `POST /auth/reset-password`
- [x] Email verification via SendGrid
- [x] Role-based access: `admin`, `client`
- [ ] Google OAuth (GitHub #64)

#### Stripe Billing (Day One)
- [x] Subscription creation on registration (Tier 1 default)
- [x] Per-location billing: base price + per-additional-location fee
- [x] Webhook handler: `invoice.paid`, `customer.subscription.deleted`, `payment_intent.payment_failed`
- [ ] Grace period (3-day) on failed payments before access revoked
- [x] Billing portal (Stripe Customer Portal)
- [ ] Plan upgrade / downgrade flow

#### Client Onboarding (4-Step Wizard)
- [x] Step 1: Business info (name, industry, primary location)
- [x] Step 2: Additional locations (address, phone, website per location)
- [x] Step 3: Target keywords (add/remove, assign to locations)
- [x] Step 4: Connect integrations (BrightLocal API key, EmbedMyReviews API key)
- [x] Trigger initial data pull on completion
- [x] Webhook registration with EmbedMyReviews

#### BrightLocal Integration
- [x] API service wrapper (rate limiting, error handling, retry)
- [x] Daily rankings pull → stored in `ranking_snapshots` table
- [x] Daily citations pull → stored in `citation_snapshots` table
- [x] Bull queue job: `brightlocal:pull` (cron `0 6 * * *`)
- [x] `GET /rankings` with locationId/keywordId/searchEngine filters
- [x] `GET /rankings/trend?keywordId=&locationId=&days=30`
- [x] `GET /citations`
- [ ] Redis cache: rankings 24h TTL, citations 24h TTL

#### EmbedMyReviews Integration
- [x] API service wrapper
- [x] 6-hour review pull → stored in `reviews` table (dedup by platform + review ID)
- [x] Bull queue job: `embedmyreviews:pull` (cron `0 */6 * * *`)
- [x] Webhook handler: `POST /reviews/webhook` (real-time inbound)
- [x] `GET /reviews` with platform/rating/status/search filters + pagination
- [ ] `GET /reviews/sentiment?dateRange=`
- [ ] Redis cache: reviews 6h TTL

#### Dashboard Pages
- [x] **Home** — 4 metric cards + keyword summary table
- [x] **Rankings** — sortable keyword table, trend chart (30d), rank delta badges
- [x] **Reviews** — review cards, filter by platform/rating/status, search
- [x] **Citations** — directory grid with completeness score
- [x] **Reports** — report history, manual generate, download button
- [x] **Settings** — account info, integrations, billing (Stripe portal link)

---

## Phase 2 — Monthly Reports (Weeks 7–9)

Automated PDF reports are a core value prop. Clients need something tangible to justify the subscription.

### Goals
- Monthly PDF report auto-generated and emailed on the 1st of each month
- Report covers rankings movement, review summary, citation health
- Historical charts showing trend since client joined

### Deliverables
- [x] Report template (HTML → PDF via Puppeteer): branded, multi-section
- [x] Sections: executive summary, rankings table (delta vs prior month), reviews breakdown, citation completeness, recommendations
- [x] Bull job: `reports:generate-monthly` (cron `0 8 1 * *`)
- [x] Reports stored in DB (`reports` table) with local file reference
- [x] SendGrid email: HTML email with PDF attachment
- [x] `GET /reports` — list all reports
- [x] `GET /reports/:id/download` — download PDF
- [x] Dashboard **Reports** page — report history, manual re-send, download button
- [x] Manual trigger endpoint: `POST /reports/generate`
- [ ] Report preview in-browser (embedded PDF viewer)

---

## Phase 3 — Historical Data & Analytics (Weeks 10–12)

Since BrightLocal provides zero historical data, everything we store from day one becomes the client's competitive advantage. Make it queryable and visualized.

### Goals
- Full historical ranking charts from the client's start date
- Month-over-month comparisons in the dashboard
- Review trend analysis with sentiment over time
- Exportable data for clients who want their own analysis

### Deliverables
- [ ] `ranking_snapshots` historical query API with arbitrary date ranges
- [ ] Ranking trend chart (Recharts): 30d / 90d / all-time toggle
- [ ] Position delta badges (↑3 / ↓1 / new) vs prior period
- [ ] Review sentiment trend over time (line chart)
- [ ] Review volume by platform over time (stacked bar chart)
- [ ] Citation completeness over time
- [ ] `GET /analytics/rankings/history?clientId=&keyword=&from=&to=`
- [ ] `GET /analytics/reviews/trend?clientId=&from=&to=`
- [ ] Bulk CSV export (all historical snapshots)
- [ ] Admin dashboard: cross-client analytics view

---

## Phase 4 — Hardening & Scale (Weeks 13–16)

Production-grade reliability, security, and monitoring before wider sales push.

### Goals
- Sub-2s p95 API response times under 50 concurrent users
- OWASP Top 10 coverage
- Automated alerting on failures
- Regression test suite protecting all prior phases

### Deliverables
- [ ] Load tests (k6): 50 concurrent, < 2s p95 ✓
- [ ] OWASP Top 10 security audit + remediation
- [ ] Prometheus metrics: request duration, queue depth, error rates
- [ ] Grafana dashboard (or Datadog) for ops visibility
- [ ] Sentry error tracking (frontend + backend)
- [ ] Automated BrightLocal pull failure alerting (email/Slack)
- [ ] Stripe webhook retry validation
- [ ] Regression test suite: all Phase 0–3 critical paths
- [ ] Full Cypress E2E suite: register → onboard → view dashboard → download report
- [ ] Penetration test checklist (auth, injection, rate limiting)
- [ ] Database backup automation (daily snapshots, 30-day retention)
- [ ] Disaster recovery runbook
- [ ] Go-live checklist: DNS, TLS, Stripe live mode, SendGrid domain auth

---

## Pricing Model

| Tier | Monthly | Included Locations | Additional Locations |
|---|---|---|---|
| Tier 1 | $350/mo | 1 | +$150/mo each |
| Tier 2 | $700/mo | 3 | +$100/mo each |
| Tier 3 | $1,200/mo | 5 | +$75/mo each |

**Our BrightLocal cost per location:** ~$21/mo (reviews $6 + citations $15)  
**EmbedMyReviews:** $99/mo flat (all clients, all locations)

Margins remain strong even at 10+ locations per client. See [docs/PRICING.md](docs/PRICING.md) for full unit economics.

---

## Tech Decisions (Final)

| Decision | Choice | Rationale |
|---|---|---|
| Server state | SWR | Handles caching, revalidation, background refresh natively |
| Client state | React Context | Auth + UI state only; no Redux overhead needed |
| ORM | Knex.js only | Migrations + type-safe queries; no TypeORM layer |
| Job queue | Bull | Cron + retry + priority queues; no n8n needed |
| HTTP client | Native fetch / SWR | No Axios dependency |
| PDF | Puppeteer | Render HTML report template → PDF server-side |

---

## Success Metrics

| Phase | Milestone |
|---|---|
| Phase 0 | All services healthy in Docker, tests passing in CI |
| Phase 1 | First paying client, card charged, dashboard live |
| Phase 2 | First automated monthly report delivered by email |
| Phase 3 | Client can view 90-day ranking trend |
| Phase 4 | 50 concurrent users < 2s p95, OWASP audit passed |
