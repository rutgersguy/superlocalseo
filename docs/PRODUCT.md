# SuperLocalSEO — Product Reference

**Audience:** Marketing, sales, copywriters, AI content tools

**Purpose:** Authoritative source of truth for **what the product does** — features,
capabilities, integrations, API surface, limitations.

> **Read [POSITIONING.md](POSITIONING.md) first if you are writing customer-facing copy.**
> That file owns audience, market framing, voice, and the lead claim; this file owns
> capabilities. [PRICING.md](PRICING.md) owns prices. Where an older agency/white-label framing
> survives anywhere in this document, POSITIONING.md supersedes it.

---

## Elevator Pitch

SuperLocalSEO tells a home-services business whether customers can find it — on Google, in the
directories that matter for its trade, and now in the AI assistants people increasingly ask for
a recommendation. It tracks rankings daily, monitors and answers reviews, re-checks listings
weekly, and mails a plain-English report every month.

**Core value proposition:** the visibility work an agency charges $1,500–5,000/mo to do,
self-serve, from $149/mo.

**What we are not:** not a white-label reseller platform, and not a $39 rank-tracking tool. See
POSITIONING.md for why that distinction governs every customer-facing surface.

---

## Target Customer

### Primary: Home-services businesses, direct
- Plumbing, HVAC, electrical, roofing — the beachhead vertical
- 1 to a few locations; owner or office manager, not a marketer
- Already pays for field-service software (Jobber, Housecall Pro, ServiceTitan) and often for
  leads (Angi, Nextdoor)
- Buys self-serve through Stripe checkout; there is no sales motion

### Also supported (not led with)
- Dental, legal, beauty, real estate, food, auto, professional services — each has its own
  vertical directory set in `directories.config.ts` and can sign up normally. We simply do not
  aim marketing at them.

### Explicitly not the customer
- **Agencies / resellers.** No white-label tier, no reseller pricing, no reseller sub-accounts.
  The 2026-era agency framing in earlier revisions of this file is **retired**; copy that
  implies a reseller offering creates support load and refund requests.

---

## Pricing

See [PRICING.md](PRICING.md) for the authoritative model, Stripe wiring, and the list of
surfaces where price is displayed. Summary as of 2026-08-20:

| Plan | Monthly | Setup | Locations |
|---|---|---|---|
| **Lite** | $149/mo | none | 1 |
| **Pro** | $349/mo | none (waived) | 1, +$125/mo each additional |

- 7-day free trial, no credit card at signup; trials run with full Pro access
- Plan is chosen at checkout; `product_line` flips to `lite` only on a paid Lite invoice
- **Never hardcode a price in a UI surface — derive from `productLine`.** Hardcoded pricing has
  shipped to production twice (#113, #125)

### Unit Economics
- Data cost is ~$1.82/mo per location (BrightLocal Data API) + $99/mo flat (EmbedMyReviews)
  across all clients — gross margin is ~97% at Pro
- Margin is not a constraint on feature decisions; see PRICING.md's vendor-cost analysis

---

## Feature Set

### 1. Keyword Rank Tracking

**What it does:** Automatically tracks where each client's locations rank on Google (and Bing) for their target keywords, every single day. Results are stored historically so clients can see progress over time.

**Key capabilities:**
- Daily automated keyword rank pulls via BrightLocal
- Tracks rank for organic, local pack, and mobile results
- Stores complete history — every snapshot, forever
- Trend charts with 30-day, 90-day, and all-time toggles
- Position delta badges (▲3 green / ▼1 red) vs. previous snapshot
- Top 3 / Top 10 keyword count summary cards
- Keywords per location — each location tracks its own set
- CSV export of all ranking data
- Auto-creates keywords from BrightLocal campaign if not already in the system

**Dashboard view:** Sortable keyword table with current rank, previous rank, delta, URL ranked, and trend sparklines.

---

### 1b. AI Assistant Visibility

**What it does:** Every Monday, asks ChatGPT, Gemini and Perplexity the questions a customer
actually asks — "who are the best plumbers in Tulsa, OK?" — with web search enabled, and records
whether the business was named, where it ranked among the businesses the assistant listed, which
competitors it named instead, and which sources it cited.

**Key capabilities:**
- Three assistants × four prompt intents (open recommendation, emergency, most trusted,
  affordable) per location, weekly, stored permanently
- Position among the businesses named, so movement is visible over time
- The competitor set each assistant volunteers — often different from the SERP competitor set
- The sources each assistant cited, as hostnames. Directly actionable: these are the pages that
  decide local recommendations, and several (Yelp, HomeAdvisor, MapQuest, BBB) are places a
  business can get itself listed
- Three-state verdicts: `mentioned` / `absent` / `unverified`. An upstream failure, a refusal, or
  a business name made entirely of generic trade words is never recorded as "not recommended"

**Runs on:** DataForSEO `ai_optimization/llm_responses` — no additional vendor. ~$0.13 per
location per prompt-set across the three engines, ~$2/location/month at weekly cadence.

**Not yet surfaced.** The measurement and its history exist; there is no API endpoint, dashboard
page or report section yet. See docs/POSITIONING.md — the landing page must not lead on this
claim until a customer can see it.

---

### 2. Review Management & Aggregation

**What it does:** Pulls in reviews from Google, Yelp, Facebook, Trustpilot, and 100+ platforms via EmbedMyReviews — every 6 hours, plus real-time via webhook. All reviews in one inbox.

**Key capabilities:**
- Reviews pulled every 6 hours; real-time updates via HMAC-verified webhook
- Filters: platform, star rating (1–5), status (new/responded), keyword search
- Stores: author name, rating, review body, platform, review date, reply status, avatar
- Tracks whether a review has been replied to, the reply text, and reply date
- `hidden` flag synced from EMR (controls widget visibility)
- Volume-by-platform stacked bar chart (30d / 90d / 180d)
- Average rating trend line chart
- CSV export with full review history
- Webhook handler processes both `review.created` and `review.updated` events
- HMAC-SHA256 signature validation on all incoming webhooks

---

### 3. AI-Powered Review Responses

**What it does:** One click generates a polished, contextual review response drafted by Claude AI (Anthropic). The client edits, approves, and copies it to the platform.

**Key capabilities:**
- Powered by Claude Haiku — fast, cost-efficient, high quality
- Tone-adaptive: warm and appreciative for 4–5★ reviews; empathetic and solution-focused for 1–3★
- Responses are specific: references the reviewer's name and details from their review
- 2–4 sentences, under 150 words — right length for Google/Yelp
- No filler phrases, no hashtags, no emojis — reads like a real owner wrote it
- Full draft lifecycle: draft → client edits → approve → copy to platform
- Approved responses stored permanently in the database
- Rate-limited to prevent abuse (20 drafts per 10 minutes per user)

**Why it matters:** Most businesses never respond to reviews. A single thoughtful response can improve conversion rate and local ranking signal. This feature alone justifies the subscription for many clients.

---

### 4. Review Request Campaigns

**What it does:** Send personalized review request emails and SMS messages to customers via EmbedMyReviews campaigns. The EMR platform automatically routes happy customers to Google and routes unhappy customers to a private feedback form — protecting your client's public reputation.

**Key capabilities:**
- Single invite: enter first name, last name (optional), email or phone number
- Bulk import: upload a CSV or paste contact data (up to 500 contacts per batch)
- Client-side CSV parser — previews first 5 contacts before sending
- Per-batch result: shows sent count and any failed invites with error details
- **Smart gating by EMR:** 4–5★ experience → directed to Google review page; 1–3★ experience → directed to private feedback form
- Funnel metrics per campaign: Invited → Opened → Clicked → Reviewed (public) + Private Feedback + Unsubscribed
- Visual funnel bars showing conversion rate at each stage
- Review rate KPI headline (reviewed ÷ invited)
- Team admin-only access — viewers cannot send invites
- Campaigns created in EmbedMyReviews dashboard, synced to SuperLocalSEO automatically

**Why it matters:** The average business that asks for reviews gets 4x more reviews than one that doesn't. Smart gating ensures negative experiences never become public 1-star reviews.

---

### 5. Citation Monitoring

**What it does:** Monitors whether a business is listed (and listed correctly) across major online directories — Google, Yelp, Yellow Pages, BBB, Bing, Apple Maps, and dozens more.

**Key capabilities:**
- Daily automated citation pull via BrightLocal
- Per-directory status: Listed / Not Listed
- NAP match: flags directories where Name, Address, or Phone doesn't exactly match
- Listing URL stored for each found citation
- Overall citation completeness score (% of directories with accurate listing)
- Directory grid view in dashboard

**Why it matters:** Inconsistent NAP data across directories is one of the top local ranking factors. Citations can take months to fix manually; knowing which ones are wrong is the first step.

---

### 6. Automated Monthly Reports

**What it does:** Generates and emails a branded PDF report to each client on the 1st of every month, summarizing the previous month's performance.

**Key capabilities:**
- Fully automated — zero manual work per client per month
- Generated via Puppeteer (HTML → PDF)
- Report sections:
  - Executive summary (key metrics and highlights)
  - Rankings table with delta vs. prior month
  - Reviews breakdown (count, average rating, sentiment)
  - Citation completeness score
  - Recommendations section
- Emailed via Resend with PDF attachment
- Report stored in database + filesystem for re-download
- Manual trigger available any time (`Generate Report` button)
- Download any historical report from the Reports page
- Per-client report history with timestamps

**Why it matters:** The monthly report is the artifact the owner actually opens. It is the recurring proof that the subscription is doing something, which is what makes a retainer-priced product renewable.

---

### 7. Historical Analytics & Trends

**What it does:** Every data point is stored permanently. Clients can query any date range for rankings, reviews, and sentiment trends.

**Key capabilities:**
- **Ranking history:** arbitrary `from`/`to` date range; filter by keyword, location, search engine
- **Review trend:** volume by platform (stacked bar), average rating over time (line chart)
- 30d / 90d / 180d quick-range toggles
- All charts built with Recharts — composable, responsive
- **CSV export** of all rankings or all reviews — full historical dump
- SWR caching for instant chart render on revisit

---

### 8. Competitor Benchmarking

**What it does:** Track named local competitors' Google ratings and review counts. See exactly where you stand in a ranked leaderboard vs. the competition.

**Key capabilities:**
- Add competitors by name — includes a built-in Google Places search so you can find the exact listing
- Auto-fills Google Place ID when you select from search results
- Tracked per competitor: Google rating (e.g. 4.6), total Google review count
- Your business stats always shown at the top for comparison: avg rating across all platforms + per-platform breakdown
- Rating bar visualizations make relative position immediately obvious
- **Google rating leaderboard:** sorted by rating, with rank #1 highlighted
- Manual sync button to pull fresh Places data on demand
- Daily automated sync job at 05:00 UTC for all competitors with a Place ID
- Admin-only access to add/remove competitors

**Why it matters:** "You're ranked #2 in your area with 4.7 stars vs. your top competitor's 4.2" is the kind of concrete win that renews contracts.

---

### 9. QR Code Review Capture

**What it does:** Generate printable QR codes that link directly to a Google review page. Every scan is tracked. Download as PNG for in-store signage, receipts, business cards, or NFC tags.

**Key capabilities:**
- Create named QR codes with any target URL (Google review links, Yelp, etc.)
- Optional location assignment (e.g., "Downtown Location" QR)
- When a location has a Google Place ID stored, the review URL is pre-filled automatically
- 8-character short code URL (e.g., `superlocalseo.com/api/qr/r/ab3x9k2m`) — scan tracking without exposing the target URL directly
- Scan count tracked per code with last-scanned timestamp
- Download PNG (400×400px, clean margins) for printing
- URL validation: only http/https targets accepted (security)
- Multiple QR codes per account — one per location, per campaign, or per use case

**Why it matters:** QR codes turn every physical touchpoint (receipts, service trucks, storefronts, business cards) into a review generation opportunity.

---

### 10. Embeddable Review Widget

**What it does:** A JavaScript snippet clients embed on their website that displays their best reviews in a responsive carousel. No iframes. Self-contained and fast.

**Key capabilities:**
- Single `<script>` tag embed — no framework required, works on any website
- Carousel layout with horizontal scroll on mobile
- Configurable appearance:
  - **Theme:** Light or dark
  - **Min rating:** Show only reviews above a threshold (e.g., 4★ and up)
  - **Max count:** 1–20 reviews displayed
  - **Platform badge:** Toggle platform icon (Google, Yelp, etc.) on/off
- Live preview in Settings — see exactly how it'll look before embedding
- Unique widget key per client (UUID); regenerate key without changing the embed tag
- Stars, platform badge, author name, time-ago, truncated review body
- CORS-open public API endpoint — works from any domain
- Admin-only access to update config and regenerate key

---

### 11. Free SEO Audit Tool (Lead Magnet)

**What it does:** A public, no-login-required audit tool at `/audit` that scans a business's local presence and returns a scored report. Used to capture leads and convert them to paid accounts.

**Key capabilities:**
- Business lookup via Google Places API (name + city input)
- 5-category scoring system (A–F grade per category):
  1. Google Business Profile completeness
  2. Review volume and average rating
  3. Citation presence
  4. Website performance indicators
  5. Local search visibility
- Overall composite score
- **Email gate:** Captures email before showing full results — stored as an audit lead
- Convert button → `/register` with pre-filled business data
- Rate-limited (5 scans/hour per IP) to prevent abuse
- All leads stored in database with their audit results for follow-up

---

### 12. Team Members & Role-Based Access

**What it does:** Invite team members to a client account with controlled permissions. For businesses with office staff or a marketing hire who need dashboard access without billing control.

**Key capabilities:**
- Two team roles: **Client/Owner** (full control, including team management) and **Staff** (all features except inviting or removing other staff)
- Email-based invite with 48-hour expiry link
- New users created automatically on invite acceptance — no pre-registration required
- Instant login after accepting invite
- Owner-only access to: Team management tab, billing
- Staff access to: All dashboard data, review response drafting, sending review invites, adding competitors, managing QR codes, updating widget config
- Team list shows: role, accepted/pending/expired status

---

### 13. Multi-Location Management

**What it does:** A single account can manage unlimited locations. Each location gets its own keywords, rankings, citations, and QR codes — all visible in one dashboard.

**Key capabilities:**
- Add unlimited locations per account (billed per location beyond tier included count)
- Per-location fields: name, address, city, state, zip, phone, website, Google Place ID
- Primary location flag
- Per-location keyword sets — different locations can track different keywords
- All data (rankings, citations, reviews) filterable by location
- Locations tied to BrightLocal campaign IDs for automated data pull

---

### 14. Security & Compliance

**What it does:** Enterprise-grade security built in from day one. Not bolted on.

**Key capabilities:**
- JWT authentication: 15-minute access tokens + 7-day refresh tokens in httpOnly cookies
- Google OAuth 2.0 sign-in support
- All third-party API keys stored AES-256 encrypted in the database
- Passwords hashed with bcrypt (no plain-text storage anywhere)
- HMAC-SHA256 webhook signature validation (Stripe + EmbedMyReviews)
- Rate limiting on auth (10/15min), general API (100/15min), AI (20/10min), audit (5/hr)
- CORS origin whitelist in production
- Open redirect protection on QR codes (http/https only)
- Timing-safe signature comparison (prevents timing attacks)
- Zod schema validation on all inputs
- Helmet.js security headers
- OWASP Top 10 audit completed

---

### 15. Monitoring & Infrastructure

**Uptime & Reliability:**
- Health check endpoints: `/api/health/live` (liveness) + `/api/health/ready` (DB + Redis check)
- Docker Compose orchestration with health-check-based startup dependencies
- `restart: unless-stopped` on all services
- Redis-backed job queue (BullMQ) with cron scheduling and retry logic

**Observability:**
- Prometheus metrics at `/api/prom-metrics` (admin token): request duration histogram, request counter, Node.js runtime metrics
- Sentry error tracking: backend (`@sentry/node`) + frontend (`@sentry/react`)
- Structured JSON logging via Winston (all requests, job events, errors)
- Job failure alerting: email sent to operator inbox on any BullMQ worker failure

**Data Protection:**
- Nightly database backups (pg_dump + gzip, 30-day retention)
- Disaster recovery runbook covering 12 failure scenarios with step-by-step commands
- Go-live checklist for production deployment

---

## Integrations

| Integration | Role | What It Powers |
|---|---|---|
| **BrightLocal** | Operator-level | Rank tracking, citation monitoring |
| **EmbedMyReviews** | Operator + client-facing | Review aggregation, review request campaigns |
| **Google OAuth 2.0** | Client sign-in | Sign in with Google; Business Profile connect |
| **Google Places API** | Operator | Audit tool, competitor lookup |
| **Stripe** | Billing | Subscriptions, per-location billing, customer portal |
| **Resend** | Transactional email | Email verification, password reset, team invites, monthly reports, job alerts |
| **Anthropic Claude** | AI features | Review response drafting |
| **Sentry** | Error monitoring | Frontend + backend error tracking |
| **Prometheus** | Metrics | Request latency, error rates, queue depth |

---

## Background Jobs (Automated, Always Running)

| Job | Frequency | What It Does |
|---|---|---|
| Rankings pull | Daily at 06:00 UTC | Fetches keyword rankings for all client locations from BrightLocal |
| Citations pull | Daily at 07:00 UTC | Fetches citation directory status for all client locations |
| Reviews pull | Every 6 hours | Fetches new/updated reviews from EmbedMyReviews for all clients |
| Competitor sync | Daily at 05:00 UTC | Pulls Google rating + review count for all tracked competitors |
| Monthly reports | 1st of each month, 08:00 UTC | Generates and emails PDF reports for all active clients |

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | React 18, TypeScript, Vite | Type-safe, fast HMR, modern toolchain |
| State | SWR + React Context | Cache-first data fetching; no Redux complexity |
| Charts | Recharts | Composable, TypeScript-native |
| Backend | Node.js, Express, TypeScript | Familiar, well-supported, fast enough |
| Database | PostgreSQL 15 | Relational, reliable, 18 tables |
| Migrations | Knex.js | Type-safe queries + schema versioning |
| Queue | BullMQ + Redis | Cron + retry + priority queues |
| PDF | Puppeteer | Server-side HTML → PDF |
| Auth | JWT + bcrypt + Google OAuth | Stateless + secure |
| Email | Resend | Deliverability + API simplicity |
| Billing | Stripe | Industry standard, per-seat billing support |
| AI | Anthropic Claude Haiku | Fast, affordable, high quality |
| QR | qrcode (npm) | Server-side PNG generation |
| Security | Helmet, Zod, HMAC | Headers, validation, webhook auth |
| Monitoring | Sentry, prom-client, Winston | Full observability stack |
| Deployment | Docker Compose + Cloudflare | Simple, reproducible, SSL-handled |

---

## Data Model (18 Tables)

| Table | Purpose |
|---|---|
| `users` | Accounts (email/password + Google OAuth) |
| `clients` | Business profile, subscription state, widget config, ROI config |
| `locations` | Per-location NAP data, BL campaign ID, Google Place ID |
| `integrations` | Connected platforms (Google, EMR, BrightLocal) with encrypted keys |
| `keywords` | Target keywords per location with optional monthly search volume |
| `ranking_snapshots` | Full rank history: keyword × location × engine × timestamp |
| `citation_snapshots` | Full citation history: location × directory × timestamp |
| `reviews` | All reviews from all platforms; 18 fields including reply status |
| `review_responses` | AI draft + final approved response per review |
| `reports` | Monthly PDF report metadata and status |
| `metrics_daily` | Pre-aggregated daily metrics (avg rank, review count, citation score) |
| `team_members` | Team invites and membership with roles |
| `emr_campaigns` | Campaign funnel snapshots (invited → reviewed conversion) |
| `competitors` | Competitor profiles with Google rating + review count |
| `qr_codes` | QR codes with short_code, target URL, scan count |
| `audit_leads` | Lead magnet captures with full audit data |
| `audit_logs` | Action audit trail |

---

## Complete API Reference (56 Endpoints)

### Auth
| Method | Endpoint | Auth |
|---|---|---|
| POST | `/api/auth/register` | — |
| POST | `/api/auth/login` | — |
| POST | `/api/auth/refresh` | cookie |
| POST | `/api/auth/logout` | jwt |
| GET | `/api/auth/verify-email` | — |
| POST | `/api/auth/forgot-password` | — |
| POST | `/api/auth/reset-password` | — |
| GET | `/api/auth/google` | — |
| GET | `/api/auth/google/callback` | — |

### Client, Locations, Keywords
| Method | Endpoint | Auth |
|---|---|---|
| GET | `/api/clients` | jwt |
| PATCH | `/api/clients` | jwt |
| GET | `/api/locations` | jwt |
| POST | `/api/locations` | jwt |
| PATCH | `/api/locations/:id` | jwt |
| DELETE | `/api/locations/:id` | jwt |
| GET | `/api/keywords` | jwt |
| POST | `/api/keywords` | jwt |
| PATCH | `/api/keywords/:id/volume` | jwt |
| DELETE | `/api/keywords/:id` | jwt |

### Rankings, Citations, Reviews
| Method | Endpoint | Auth |
|---|---|---|
| GET | `/api/rankings` | jwt |
| GET | `/api/rankings/trend` | jwt |
| GET | `/api/citations` | jwt |
| GET | `/api/reviews` | jwt |
| POST | `/api/reviews/webhook` | hmac |
| GET | `/api/reviews/:id/response` | jwt |
| POST | `/api/reviews/:id/response/draft` | jwt |
| PATCH | `/api/reviews/:id/response` | jwt |

### Analytics, Metrics, Reports
| Method | Endpoint | Auth |
|---|---|---|
| GET | `/api/analytics/rankings/history` | jwt |
| GET | `/api/analytics/reviews/trend` | jwt |
| GET | `/api/analytics/export` | jwt |
| GET | `/api/analytics/roi` | jwt |
| PATCH | `/api/analytics/roi-config` | jwt |
| GET | `/api/metrics` | jwt |
| GET | `/api/reports` | jwt |
| POST | `/api/reports/generate` | jwt |
| GET | `/api/reports/:id/download` | jwt |

### Campaigns, Competitors, QR
| Method | Endpoint | Auth |
|---|---|---|
| GET | `/api/campaigns` | jwt |
| POST | `/api/campaigns/:id/invite` | jwt+admin |
| POST | `/api/campaigns/:id/invite/bulk` | jwt+admin |
| GET | `/api/competitors` | jwt |
| GET | `/api/competitors/search` | jwt |
| POST | `/api/competitors` | jwt+admin |
| DELETE | `/api/competitors/:id` | jwt+admin |
| POST | `/api/competitors/:id/sync` | jwt+admin |
| GET | `/api/qr` | jwt |
| POST | `/api/qr` | jwt+admin |
| DELETE | `/api/qr/:id` | jwt+admin |
| GET | `/api/qr/:id/image.png` | jwt |
| GET | `/api/qr/r/:code` | — (public) |

### Team, Billing, Widget, Integrations
| Method | Endpoint | Auth |
|---|---|---|
| GET | `/api/team` | jwt |
| POST | `/api/team/invite` | jwt+admin |
| DELETE | `/api/team/:id` | jwt+admin |
| GET | `/api/team/accept` | — |
| POST | `/api/team/accept` | — |
| GET | `/api/billing` | jwt |
| POST | `/api/billing/portal` | jwt |
| GET | `/api/widget` | jwt |
| GET | `/api/widget/:key` | — (public) |
| PATCH | `/api/widget` | jwt+admin |
| POST | `/api/widget/regenerate` | jwt+admin |
| GET | `/api/integrations` | jwt |
| GET | `/api/integrations/google/auth-url` | jwt |
| DELETE | `/api/integrations/:provider` | jwt |

### Public & Ops
| Method | Endpoint | Auth |
|---|---|---|
| POST | `/api/audit/scan` | — (rate-limited) |
| POST | `/api/audit/capture` | — |
| GET | `/api/health/live` | — |
| GET | `/api/health/ready` | — |
| GET | `/api/prom-metrics` | admin token |
| POST | `/webhooks/stripe` | hmac |
| POST | `/api/reviews/webhook` | hmac |

---

## Feature Status Summary

### Production-Ready ✅
- Email/password + Google OAuth authentication
- Stripe billing (3 tiers, per-location, webhooks, portal)
- 4-step onboarding wizard
- Multi-location management
- Daily keyword rank tracking (BrightLocal)
- Daily citation monitoring (BrightLocal)
- Review aggregation + 6-hour pull + real-time webhook (EMR)
- AI review response drafting (Claude Haiku)
- Review request campaigns with smart gating (EMR)
- Automated monthly PDF reports via email
- Historical analytics (rankings + reviews, any date range)
- CSV data export
- Team members + RBAC (owner / admin / viewer)
- Free SEO audit lead magnet
- Embeddable review widget (JS carousel)
- Competitor benchmarking (Google Places)
- QR code generation + scan tracking
- Prometheus metrics + Sentry error tracking
- OWASP-audited security posture
- Nightly DB backup + disaster recovery runbook

### In Progress / Partial ⚠️
- ROI estimation (data model + backend done; full UI dashboard pending)
- Citation completeness over time chart (data stored; chart not built)

### Planned (Phase 2) ❌
- QR code review capture (Phase 2 — code exists, not actively promoted)
- Grace period automation for failed payments
- Plan upgrade / downgrade flow UI
- Yelp OAuth integration
- Facebook OAuth integration
- Google Business Profile automated review pull via GBP API — **blocked**: our Google Cloud
  project's GBP API quota request is still pending approval (`quota_limit_value: 0`), so this
  returns nothing for every client until Google grants it
- ~~Google Business Profile Q&A sync~~ — **CANCELLED.** Google discontinued the My Business Q&A
  API on 2025-11-03 and is removing the public Q&A surface from Business Profiles. No vendor can
  read or post GBP Q&A. Do not build this. (See `INTEGRATIONS.md`.)
- Admin cross-client analytics dashboard
- White-label reseller program
- Mobile app (iOS / Android)
- In-app support chat (Crisp — blocked on email verification)
- BrightLocal Management API for automated citation submission (currently on free tier)

---

## Limitations

Honest constraints to communicate to prospects and inform product decisions:

### Data & Coverage
- **Review platforms:** Review aggregation depends on EmbedMyReviews platform support. Not all review platforms are available; coverage varies by region.
- **Citation directories:** Citation monitoring covers the directories supported by BrightLocal Data API. Automated citation *submission* is not yet active (Manual workflow provided instead).
- **Competitor benchmarking:** Uses Google Places ratings only — not aggregate cross-platform rating. Reflects Google specifically.
- **Ranking data:** Rankings are pulled daily, not real-time. Rank positions can fluctuate multiple times per day; snapshots represent one point in time.

### Billing
- No automated grace period for failed payments — `past_due` status blocks access immediately after the Stripe `invoice.payment_failed` webhook. Manual intervention required to re-enable access.
- No self-service plan upgrade/downgrade UI — tier changes require operator action.
- Extra-location billing is prorated automatically by Stripe; however, removing a location mid-month does not immediately remove the charge until the next billing cycle.

### SEO Audits
- On-page SEO audit crawls one page (the homepage/website URL stored on the location). Deep multi-page crawls are not supported.
- Lighthouse performance data has a 5–90 second async delay; the performance section shows a "Fetching..." state until the DataForSEO task completes.
- Lighthouse results reflect server-side rendering performance, not real user metrics (CrUX data).

### Infrastructure
- Single-node Docker Compose deployment. No built-in horizontal scaling or high availability. Planned downtime required for major updates.
- PDF report generation uses Puppeteer/Chromium and is memory-intensive; concurrent report generation is limited to ~3 simultaneous requests on a 4 GB VPS.

### QR Codes (Phase 2)
- QR code feature is built and functional but not actively promoted. Scan tracking works; no analytics dashboard for scan trends over time.
