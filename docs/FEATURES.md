# SuperLocalSEO — Complete Feature Reference

> **Scope:** This document covers every feature, API endpoint, background job, email, data model, and workflow in the SuperLocalSEO platform as of the current production build. It is intended as the authoritative internal reference for developers, operators, and future contributors.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Architecture Summary](#2-architecture-summary)
3. [Authentication & User Accounts](#3-authentication--user-accounts)
4. [Client Onboarding](#4-client-onboarding)
5. [Locations & Business Profiles](#5-locations--business-profiles)
6. [Keyword Tracking](#6-keyword-tracking)
7. [Keyword Rankings & Analytics](#7-keyword-rankings--analytics)
8. [ROI & Revenue Attribution](#8-roi--revenue-attribution)
9. [Review Management](#9-review-management)
10. [AI Review Responses](#10-ai-review-responses)
11. [Review Request Campaigns](#11-review-request-campaigns)
12. [Citation Tracking & Directory Submissions](#12-citation-tracking--directory-submissions)
13. [Competitor Benchmarking & Gap Analysis](#13-competitor-benchmarking--gap-analysis)
14. [SEO Audit Tools](#14-seo-audit-tools)
15. [Geo-Grid Visibility Maps](#15-geo-grid-visibility-maps)
16. [Monthly PDF Reports](#16-monthly-pdf-reports)
17. [Platform Integrations](#17-platform-integrations)
18. [Team Management & RBAC](#18-team-management--rbac)
19. [Review Widgets](#19-review-widgets)
20. [QR Codes & NFC Review Capture](#20-qr-codes--nfc-review-capture)
21. [Reputation Management](#21-reputation-management)
22. [Billing & Subscription Management](#22-billing--subscription-management)
23. [White-Label Reports](#23-white-label-reports)
24. [Admin Panel](#24-admin-panel)
25. [Background Job System](#25-background-job-system)
26. [Email System](#26-email-system)
27. [Database Schema](#27-database-schema)
28. [Security Model](#28-security-model)
29. [QA & Testing](#29-qa--testing)
30. [Deployment & Environment Configuration](#30-deployment--environment-configuration)

---

## 1. Product Overview

SuperLocalSEO is a multi-tenant SaaS platform for local SEO management. It is sold to small and medium businesses (and agencies) at three subscription tiers and automates the most time-intensive parts of local search optimisation: tracking keyword positions, managing reviews across platforms, monitoring citation consistency, benchmarking competitors, and producing branded monthly reports.

**Core value proposition:**
- One dashboard to track all aspects of local search visibility
- Automated daily data pulls — rankings, reviews, citations — so the client sees fresh data without any manual work
- AI-assisted review response drafting
- Automatic monthly PDF reports delivered by email
- White-label reports (Pro tier) for agency resale

**Pricing tiers:**

| Tier | Monthly | Included Locations | Extra Locations |
|---|---|---|---|
| Starter (Tier 1) | $350/mo | 1 | +$150/mo each |
| Growth (Tier 2) | $700/mo | 3 | +$100/mo each |
| Pro (Tier 3) | $1,200/mo | 5 | +$75/mo each |

All new accounts start on a **14-day free trial** (Tier 1 by default). After trial expiry, access is gated. A **3-day grace period** is applied when a payment fails before access is revoked.

---

## 2. Architecture Summary

```
Browser (React/Vite)
       │
       ▼
Nginx (reverse proxy + static files)
       │
       ├── /api/* ──► Express API (Node.js / TypeScript)
       │                    ├── JWT auth middleware
       │                    ├── Route handlers (controllers)
       │                    ├── BullMQ job queues (Redis-backed)
       │                    │       └── Workers (background jobs)
       │                    ├── Knex.js → PostgreSQL
       │                    └── External APIs:
       │                            ├── BrightLocal (rankings, citations, audits, geo-grid)
       │                            ├── EmbedMyReviews (review aggregation & campaigns)
       │                            ├── Stripe (billing)
       │                            ├── Resend (transactional email)
       │                            ├── Google APIs (OAuth, Places, My Business)
       │                            ├── Facebook Graph API
       │                            └── Anthropic Claude API (AI responses)
       │
       └── /r/:code ──► QR Code redirect (no auth, scan tracking)
```

**Tech stack:**
- **Backend**: Node.js 20, TypeScript, Express, Knex.js, BullMQ, ts-node
- **Frontend**: React 18, Vite, TypeScript, SWR, Recharts, Tailwind CSS, Lucide icons
- **Database**: PostgreSQL (primary data store, 18+ tables)
- **Cache/Queue**: Redis (JWT blocklist, rate limiting, BullMQ job queues)
- **Containerisation**: Docker Compose (dev + production variants)
- **Error tracking**: Sentry (frontend + backend, graceful no-op when DSN not set)
- **Monitoring**: Prometheus metrics at `/api/prom-metrics`

---

## 3. Authentication & User Accounts

### Overview

Authentication uses a dual-token scheme: a short-lived **access token** (JWT, default 15 minutes) passed in the `Authorization: Bearer` header, and a long-lived **refresh token** (JWT, default 7 days) stored in an `httpOnly` cookie. This prevents XSS token theft while still allowing silent re-authentication.

### Registration

**`POST /api/auth/register`**

```json
{
  "email": "user@example.com",
  "password": "MyPassword1!",
  "businessName": "Acme Plumbing"
}
```

Validation rules:
- `email`: valid email format, unique in the system
- `password`: minimum 8 characters (Zod refinement)
- `businessName`: 2–255 characters

What happens on registration:
1. Password hashed with bcrypt (cost factor 10)
2. `users` row created with `email_verified = false`
3. `clients` row created with `subscription_status = 'trialing'`, `trial_ends_at = now + 14 days`, `onboarding_step = 0`
4. Stripe customer created via `createCustomer()` — `stripe_customer_id` stored on `users` table
5. Email verification token generated (UUID stored in Redis with 24hr TTL), sent via Resend
6. Welcome email sent asynchronously (non-blocking)

> **Note:** No Stripe subscription is created at registration. The subscription is created later when the user completes the billing flow (`POST /api/billing/subscription-intent`). Until then, `stripe_subscription_id` is NULL and access is gated purely by `subscription_status = 'trialing'` and `trial_ends_at`.

Returns: `{ userId, clientId }` — **no access token on registration** (user must verify email and log in).

### Email Verification

**`GET /api/auth/verify-email?token=<uuid>`**

- Looks up token in Redis; marks `users.email_verified = true`; deletes token
- 24-hour TTL — expired tokens return 400

### Login

**`POST /api/auth/login`**

```json
{ "email": "user@example.com", "password": "MyPassword1!" }
```

- Validates credentials, checks `email_verified`
- Returns `{ accessToken }` in JSON body
- Sets `refreshToken` cookie: `httpOnly`, `secure` (production), `sameSite: strict`, `path: /api/auth`, `maxAge: 7 days`
- Blocked by auth rate limiter (20 attempts per 15-minute window per IP)

### Silent Token Refresh

**`POST /api/auth/refresh`**

Called automatically by the frontend on app load (via `useAuthState` hook). Uses the `refreshToken` cookie — no body required.

- Validates refresh token signature and Redis blocklist
- Issues new access token + rotates refresh token (single-use rotation)
- Returns `{ accessToken }`

The frontend decodes the JWT payload (base64) to extract `userId` and `role` — no additional `/me` endpoint needed.

**Deduplication:** The frontend maintains a single in-flight `refreshToken()` promise (in `api.ts`). Both `useAuthState` on mount and the 401 interceptor share this singleton — concurrent callers receive the same promise rather than issuing parallel refresh requests. This prevents double-consumption of the single-use refresh token.

**Race safety (Google OAuth):** `AuthGoogleSuccess` calls `setToken(token)` synchronously before navigating. `useAuthState`'s refresh runs concurrently; if it fails (e.g. no cookie yet), it uses a functional state update that preserves `isAuthenticated: true` if `setToken` already ran.

### Password Reset

Two-step flow:

1. **`POST /api/auth/forgot-password`** — `{ email }` — generates a reset token (stored in Redis, 1hr TTL), sends reset link
2. **`POST /api/auth/reset-password`** — `{ token, password }` — validates token, updates password hash, invalidates all existing refresh tokens for the user

### Google OAuth (Sign-in)

**`GET /api/auth/google`** → redirects to Google OAuth consent screen

Scopes: `openid`, `email`, `profile`

**`GET /api/auth/google/callback?code=&state=`** → exchanges code for ID token

- If Google ID exists in `users.google_id`: logs in existing user
- If email exists but no Google ID: links the Google account to the existing user
- If new user: creates `users` + `clients` (same as email registration), skips email verification

On success, redirects to `/auth/google/success?token=<accessToken>`. The frontend at that route calls `setToken(token)` to hydrate auth state, then redirects to `/dashboard`.

### Logout

**`POST /api/auth/logout`**

- Adds current refresh token to Redis blocklist (TTL = remaining token lifetime)
- Clears the refresh cookie

### Role System

JWT payload contains: `{ userId, role }`. Two roles exist:

| Role | Access |
|---|---|
| `client` | Own data only. Full dashboard access. |
| `admin` | All dashboard features + `/admin/*` endpoints. Set directly in DB. |

Team members inherit the client's data scope with role-based restrictions (`admin` can write, `viewer` read-only).

---

## 4. Client Onboarding

### Overview

A 4-step wizard at `/onboarding` guides new users to a working setup. All steps update `clients.onboarding_step` (0–4). After completion, the user is redirected to `/dashboard/settings?tab=billing` to choose a plan.

### Steps

**Step 1 — Business Info**
- Set `businessName` and `industry` (dropdown: Plumbing, HVAC, Electrical, Landscaping, Cleaning, Other)
- `PATCH /api/clients` with `{ businessName, industry, onboardingStep: 1 }`

**Step 2 — Locations**
- Add one or more business locations (name, address, city, state, zip, phone)
- Each location includes a **service area** field — an autocomplete chip input backed by `/places/cities` (Google Places, 300ms debounce) that stores up to 20 nearby cities as a JSONB array; these cities are used in rankings and competitor SERP scans
- Each location is saved immediately via `POST /api/locations` when added — first is marked `is_primary = true`
- Adding a location also auto-seeds starter keywords from the industry config
- `PATCH /api/clients` with `{ onboardingStep: 2 }` on Next

**Step 3 — Keywords**
- Add target keywords per location (tag-style input)
- Each keyword is saved immediately via `POST /api/keywords` with `{ locationId, keyword }`
- Removing a keyword calls `DELETE /api/keywords/:id`
- `PATCH /api/clients` with `{ onboardingStep: 3 }` on Next

**Step 4 — Connect Platforms**
- Google Business Profile OAuth connect button
- Facebook card links to **Settings → Integrations** to connect after onboarding (no OAuth during the wizard)
- On clicking Finish: `POST /api/clients/complete-onboarding`
  - Sets `onboarding_step = 4`
  - Attempts to provision an EmbedMyReviews sub-account (12-second timeout, non-blocking)
  - Enqueues citation scan job
  - Enqueues initial rankings pull (`rankingsQueue`, job name `onboarding-pull`) — non-fatal if queue is unavailable
  - Returns `{ provisioned: boolean }` — clients can proceed regardless

### Post-Onboarding

After onboarding completes, the app redirects to `/dashboard`. The 14-day trial is already active — no payment is required at this point.

If the user navigates to `/billing`, the page shows a **soft landing** ("You're on a free trial — no payment needed yet") for users with more than 7 days remaining. They can optionally click "Subscribe early anyway" to proceed to the card form. Users with ≤7 days left see the payment form directly.

---

## 5. Locations & Business Profiles

### Concept

A **location** represents a single physical business location. All ranking, citation, review, and audit data is scoped to a location. Each client can have multiple locations (within their tier's included count; additional locations are billed via Stripe line items).

### Endpoints

**`GET /api/locations`**
Returns all locations for the authenticated client, sorted by `is_primary DESC`, then `created_at ASC`.

Response fields: `id`, `clientId`, `name`, `address`, `city`, `state`, `zip`, `phone`, `website`, `isPrimary`, `brightlocalCampaignId`, `createdAt`

**`POST /api/locations`**
```json
{
  "name": "Downtown Branch",
  "address": "123 Main St",
  "city": "Austin",
  "state": "TX",
  "zip": "78701",
  "phone": "512-555-0100",
  "website": "https://acmeplumbing.com"
}
```

- First location → `is_primary = true`
- Subsequent locations on an active subscription → adds a line item to the Stripe subscription at the tier's extra-location price

**`PATCH /api/locations/:id`** — Updates any of the above fields

**`DELETE /api/locations/:id`**
- Prevents deletion of the only location
- Prevents deletion of the primary location
- On active subscription: removes the Stripe subscription line item for that location

### BrightLocal Campaign Linkage

Each location has a `brightlocal_campaign_id` field. This is set manually (or via BrightLocal API) and is required for rankings, citation pulls, and audit reports to function. Without it, the location is tracked in the system but no BrightLocal data is pulled.

---

## 6. Keyword Tracking

### Endpoints

**`GET /api/keywords?locationId=<uuid>`**
Returns all keywords for the specified location. If `locationId` is omitted, returns all keywords across all locations for the client.

Response: `[ { id, locationId, keyword, monthlySearchVolume, createdAt } ]`

**`POST /api/keywords`**
```json
{ "locationId": "<uuid>", "keyword": "plumber Austin TX" }
```
- Prevents duplicate keywords per location (case-insensitive on insert)
- `monthlySearchVolume` starts as `null`; populated by the ROI system

**`PATCH /api/keywords/:id/volume`**
```json
{ "monthlySearchVolume": 880 }
```
Used by the ROI config to store estimated monthly search volume per keyword. This drives the revenue estimate calculations.

**`DELETE /api/keywords/:id`** — Deletes keyword and all associated ranking snapshots (cascade)

---

## 7. Keyword Rankings & Analytics

### How Rankings Are Tracked

Rankings data flows from BrightLocal via the daily pull job. BrightLocal runs search engine queries for each keyword in a campaign and returns the rank your business appears at, the URL that ranked, the search engine (google, bing), and the rank type (organic, local_pack, paid).

All results are stored as **immutable snapshots** in `ranking_snapshots` — historical data is never overwritten, enabling trend analysis over any date range.

### Rankings API

**`GET /api/rankings`**

Query parameters:
- `locationId` — filter to a specific location
- `keywordId` — filter to a specific keyword
- `searchEngine` — `google` or `bing`
- `rankType` — `organic`, `local_pack`, or `paid`
- `limit` (default 50, max 200)
- `page` (default 1)

Returns the **latest snapshot** per keyword+location combination, with rank delta calculated against the previous snapshot:

```json
{
  "rankings": [
    {
      "keywordId": "...",
      "keyword": "plumber Austin TX",
      "locationId": "...",
      "location": "Downtown Branch",
      "rank": 3,
      "previousRank": 7,
      "delta": 4,
      "searchEngine": "google",
      "rankType": "organic",
      "urlRanked": "https://acmeplumbing.com",
      "pulledAt": "2026-05-01T06:00:00Z"
    }
  ]
}
```

A positive `delta` means the ranking **improved** (moved closer to #1). A negative delta means it dropped. `null` means no previous snapshot exists.

**`GET /api/rankings/trend?keywordId=&locationId=&days=30`**

Returns average rank grouped by date over the specified number of days. Used for the trend line chart in the Rankings page.

```json
{
  "trend": [
    { "date": "2026-04-01", "avgRank": 8.2 },
    { "date": "2026-04-02", "avgRank": 7.9 }
  ]
}
```

**`GET /api/analytics/rankings/history`**

Query params: `from`, `to` (ISO dates), `keywordId`, `locationId`, `rankType`, `days`

Returns raw snapshots for arbitrary date ranges — used for the full history view.

### Rankings Page Walkthrough

1. **Keyword table** — sorted by rank (ascending). Each row shows: keyword, location, current rank, previous rank, delta badge (▲ green for improvement, ▼ red for drop), search engine, last checked date.
2. **Time range toggle** — 30 days / 90 days / All time. Controls the trend chart data range.
3. **Trend chart** — Line chart (Recharts LineChart) showing average rank over time. Lower y-axis = better rank.
4. **Rank type filter** — All / Organic / Local Pack / Paid.
5. **ROI panel toggle** — Opens the ROI revenue estimation section (see Section 8).
6. **CSV export** — `GET /api/analytics/export?type=rankings` returns `keyword, location, rank, search_engine, pulled_at` as CSV.

---

## 8. ROI & Revenue Attribution

### Concept

Each keyword ranking has an associated **click-through rate** based on its position. Using the client's average customer value and conversion rate, the system estimates monthly revenue attributable to each keyword's search visibility.

### CTR Model

| Rank | CTR |
|---|---|
| 1 | 28.5% |
| 2 | 15.7% |
| 3 | 11.0% |
| 4–10 | 3–8% (linear interpolation) |
| 11–20 | 1.0% |
| 21+ | 0.3% |

### Formula

```
estClicks    = monthlySearchVolume × CTR(rank)
estLeads     = estClicks × (conversionRate / 100)
estRevenue   = estLeads × avgCustomerValue
```

### Configuration

**`PATCH /api/analytics/roi-config`**
```json
{
  "avgCustomerValue": 500,
  "conversionRate": 10
}
```
Stored in `clients.roi_config` (jsonb). Persists across sessions.

Also accessible via the ROI Settings section in `/dashboard/settings > Account`.

### ROI API

**`GET /api/analytics/roi`**

Returns:
```json
{
  "roiConfig": { "avgCustomerValue": 500, "conversionRate": 10 },
  "keywords": [
    {
      "keywordId": "...",
      "keyword": "plumber Austin TX",
      "rank": 3,
      "monthlySearchVolume": 880,
      "estClicks": 97,
      "estLeads": 10,
      "estRevenue": 4840
    }
  ],
  "totals": {
    "estClicks": 312,
    "estLeads": 31,
    "estRevenue": 15620
  }
}
```

### Rankings Page ROI Display

When ROI is configured:
- **ROI summary bar** appears above the keyword table showing total Est. Clicks, Est. Leads, Est. Revenue/month
- **Est. Revenue column** added to the keyword table
- An ROI config panel appears in the Rankings page (collapsible) to edit avgCustomerValue and conversionRate inline

---

## 9. Review Management

### Data Sources

Reviews reach the system through three channels:

1. **EmbedMyReviews (EMR)** — Primary aggregation platform. Pulls from Google, Facebook, Yelp, TripAdvisor, and others. Synced every 6 hours via background job.
2. **Real-time webhook** — EMR sends a webhook on `review.created` and `review.updated` for instant ingestion.
3. **Google Business Profile (GBP)** — Direct pull via Google My Business API v4 for clients with Google OAuth connected.
4. **Facebook Graph API** — Direct pull via `/{pageId}/ratings` for clients with Facebook OAuth connected.

### Reviews API

**`GET /api/reviews`**

Query parameters:
- `platform` — `google`, `facebook`, `yelp`, etc.
- `rating` — integer 1–5 (exact match)
- `status` — `new`, `responded`, `ignored`
- `search` — full-text search on `author_name` and `body`
- `page` (default 1), `limit` (default 20)

Returns paginated review list with all fields:

```json
{
  "reviews": [
    {
      "id": "...",
      "platform": "google",
      "authorName": "Jane Smith",
      "rating": 5,
      "body": "Excellent service, highly recommend!",
      "sentiment": "positive",
      "status": "new",
      "reviewDate": "2026-04-28T14:00:00Z",
      "platformUrl": "https://g.page/...",
      "replied": false,
      "replyDate": null,
      "avatarUrl": "https://...",
      "verified": true
    }
  ],
  "total": 142,
  "page": 1,
  "pages": 8
}
```

**`GET /api/reviews/feedback`**

Returns private feedback (1–3 star responses collected via the campaign's private-feedback URL). Contact info is **masked** for privacy: `john***@gmail.com`, phone `555-***-1234`.

### Real-Time Webhook

**`POST /api/reviews/webhook`**

EmbedMyReviews sends HMAC-SHA256-signed payloads. The `x-embedmyreviews-signature` header is validated using the `EMBEDMYREVIEWS_WEBHOOK_SECRET` environment variable with a timing-safe comparison. Malformed or unsigned payloads return `401`.

Supported events:
- `review.created` → upserts review record
- `review.updated` → syncs reply status only (preserves local edits)

### Reviews Page Walkthrough

1. **Platform filter tabs** — All / Google / Facebook / Yelp / TripAdvisor / Other
2. **Rating filter** — 1★–5★ chips
3. **Status filter** — New / Responded / Ignored
4. **Search** — searches author name and review body
5. **Review cards** — Each card shows: avatar, author, star rating, platform badge, review date, body text (truncated with expand), and action buttons:
   - **Draft AI response** — one click generates a Claude Haiku draft
   - **Approve & Copy** — approves the draft and copies to clipboard for pasting on the platform
   - **Post to Google** — (BrightLocal integrated) opens modal to post reply directly
6. **Volume chart** — Stacked bar chart (by platform) for last 30/90/180 days
7. **Sentiment trend** — Average rating trend line
8. **Private Feedback tab** — Separate view of private feedback contacts
9. **CSV export** — `GET /api/analytics/export?type=reviews`

### Analytics

**`GET /api/analytics/reviews/trend`**

Query params: `days=30`, `from`, `to`, `platform`

Returns:
```json
{
  "volume": [
    { "date": "2026-04-01", "platform": "google", "count": 3, "avgRating": 4.7 }
  ],
  "sentiment": [
    { "date": "2026-04-01", "avgRating": 4.5 }
  ]
}
```

---

## 10. AI Review Responses

### Overview

For each review, a client can request an AI-drafted response generated by Claude Haiku. The draft is stored in the database, allowing the user to edit it before approving. Once approved, they can copy it to the clipboard or post it directly via BrightLocal.

### Workflow

1. Client clicks **"Draft Response"** on a review card
2. `POST /api/reviews/:id/response/draft` is called
3. Server sends the review context to Claude Haiku:
   - businessName, industry, authorName, rating (1–5), body, platform
   - System prompt instructs: professional tone, thank the reviewer, address concerns if rating < 4, never fabricate specifics
4. Draft stored in `review_responses` table with `status: draft`
5. Client can edit the text in the response input field
6. `PATCH /api/reviews/:id/response` — `{ body: "...", approve: true }` marks as approved
7. On approval: `status = 'approved'`, `approved_at = now`, `review.status = 'responded'`

### API

**`POST /api/reviews/:id/response/draft`**

No request body required. Returns:
```json
{
  "draftBody": "Thank you so much, Jane! We're delighted to hear...",
  "finalBody": null,
  "status": "draft",
  "approvedAt": null
}
```

**`PATCH /api/reviews/:id/response`**
```json
{ "body": "Thank you so much, Jane! ...", "approve": true }
```

**`GET /api/reviews/:id/response`** — Fetches current draft/approved response or `null`

### Rate Limiting

AI drafts are subject to the `aiLimiter` middleware: 20 requests per 10-minute window per IP. This prevents runaway API costs.

---

## 11. Review Request Campaigns

### Overview

Built on the EmbedMyReviews campaign API. Clients send review request invitations to customers via email and/or SMS. The campaign uses a **gating** mechanism: customers who leave 4–5 stars are directed to a public review platform (Google, Facebook, etc.); those who leave 1–3 stars are captured as **private feedback** instead, protecting the public rating.

### Campaign Funnel Metrics

For each EMR campaign, the following metrics are tracked:
- **Invited** — total invitations sent
- **Opened** — invitation email/SMS opened
- **Clicked** — link clicked
- **Reviewed** — public review submitted
- **Private Feedback** — 1–3 star private response captured
- **Unsubscribed** — opted out of review requests

### API Endpoints

**`GET /api/campaigns`**

Returns all EMR campaigns linked to the client, with funnel metrics:
```json
{
  "campaigns": [
    {
      "id": "...",
      "emrCampaignId": "abc123",
      "name": "Post-Service Follow-up",
      "invited": 142,
      "opened": 89,
      "clicked": 54,
      "reviewed": 31,
      "privateFeedback": 8,
      "unsubscribed": 3,
      "metricsPulledAt": "2026-05-01T00:00:00Z"
    }
  ]
}
```

**`POST /api/campaigns/:campaignId/invite`**
```json
{
  "firstName": "John",
  "lastName": "Smith",
  "email": "john@example.com",
  "phone": "+15125550100"
}
```
Either `email` or `phone` is required (not both mandatory). Triggers an immediate invitation via EMR API.

**`POST /api/campaigns/:campaignId/bulk-invite`**
```json
{
  "contacts": [
    { "firstName": "John", "lastName": "Smith", "email": "john@example.com" },
    { "firstName": "Mary", "lastName": "Jones", "phone": "+15125550101" }
  ]
}
```
- Maximum 500 contacts per request
- Returns `{ sent, failed, skipped, failures: [ { index, error } ] }`
- `failed` contacts are reported with their index and error reason for debugging

**`POST /api/campaigns`** *(requires team admin)*
```json
{ "name": "Post-Service Follow-up", "templateId": "optional-emr-template-id" }
```
Creates a new campaign in EMR and stores a local record in `emr_campaigns`. Returns `503 EMR_UNAVAILABLE` (with user-friendly message) if the EMR API is unreachable, rather than a generic 500.

**`GET /api/campaigns/credits`**

Returns remaining invitation credits:
```json
{ "email": 450, "sms": 200, "total": 650, "connected": true, "available": true }
```
- `connected: true` — an EMR API key is configured for this client (operator fallback counts)
- `available: true` — the EMR API responded successfully; credits are accurate
- When the EMR API is unreachable, returns `{ connected: true, available: false, email: 0, sms: 0, total: 0 }` rather than a 500

**`GET /api/campaigns/unsubscribes`**

Returns masked unsubscribe list (email shown as `j***@gmail.com`, SMS as `512-***-0100`). Returns empty list silently if the EMR API is unreachable.

**`GET /api/campaigns/templates`**

Returns available invitation templates from EMR.

### EMR Key Resolution

`getClientEMRKey(clientId)` resolves the API key to use in this order:

1. Per-client key from `integrations` table (status `connected`, `api_key_encrypted` not null)
2. Operator-level key from `EMBEDMYREVIEWS_API_KEY` env var (covers legacy/unprovisioned clients)
3. `null` — no key at all (EMR features disabled)

### EMR Provisioning

`provisionClient(clientId)` creates a per-client EMR sub-account via the agency API and stores the resulting API key in `integrations`. If the agency API fails (plan limitation, API unavailable), it falls back to storing the shared operator key. This makes the function idempotent and safe to retry.

`deprovisionClient(clientId)` suspends the sub-account when a subscription is canceled.

`deleteClientEMR(clientId)` hard-deletes the sub-account when a client record is permanently removed.

> **Known gap:** `deleteClientEMR` is not currently called when a client is deleted via the admin panel. EMR sub-accounts are orphaned on admin delete. Manual cleanup in the EMR agency dashboard is required until this is wired up.

### Campaigns Page Walkthrough

1. **Campaign cards** — Each campaign shows the full funnel with a mini conversion funnel visualisation (invited → opened → clicked → reviewed)
2. **Create campaign** — Modal with optional template picker; calls `POST /api/campaigns`
3. **Invite panel** — Single-contact invite form (name, email, phone)
4. **Bulk invite** — CSV upload or paste (up to 500 contacts); unsubscribed contacts auto-skipped
5. **Credit display** — Email and SMS credits remaining (hidden when unavailable)
6. **Unsubscribe list** — Masked view of opted-out contacts

---

## 12. Citation Tracking & Directory Submissions

### Concept

A **citation** is any mention of a business's NAP (Name, Address, Phone) in an online directory (Google, Yelp, Bing, Apple Maps, Yellow Pages, etc.). Citation consistency (exact NAP matches) is a known local SEO ranking factor.

BrightLocal audits ~80+ directories for each location, tracking whether the business is listed and whether the NAP information is accurate.

### Citation Data

**`GET /api/citations?locationId=<uuid>`**

Returns the latest citation snapshot grouped by location:

```json
{
  "citations": [
    {
      "locationId": "...",
      "locationName": "Downtown Branch",
      "summary": {
        "totalDirectories": 82,
        "listed": 61,
        "notListed": 21,
        "napAccurate": 54
      },
      "citations": [
        {
          "directory": "Google Business Profile",
          "listed": true,
          "napMatch": true,
          "listingUrl": "https://maps.google.com/...",
          "napDetail": {
            "nameMatch": true,
            "addressMatch": true,
            "phoneMatch": true,
            "listedName": "Acme Plumbing",
            "listedAddress": "123 Main St, Austin TX 78701",
            "listedPhone": "512-555-0100"
          }
        },
        {
          "directory": "Yelp",
          "listed": true,
          "napMatch": false,
          "napDetail": {
            "nameMatch": true,
            "addressMatch": false,
            "phoneMatch": true,
            "listedAddress": "123 Main Street, Austin TX 78701"
          }
        }
      ]
    }
  ]
}
```

### Citation History

**`GET /api/citations/history?locationId=&days=90`**

Returns daily completeness scores for trend charting:
```json
{
  "history": [
    { "date": "2026-03-01", "listedCount": 58, "totalCount": 82, "completeness": 70.7 },
    { "date": "2026-04-01", "listedCount": 61, "totalCount": 82, "completeness": 74.4 }
  ]
}
```
Powered by `DISTINCT ON (date)` over `citation_snapshots` table.

### Automated Citation Submissions

**`POST /api/citations/submit`**
```json
{ "locationId": "<uuid>", "directories": ["yelp", "bing", "apple-maps"] }
```
- If `directories` is omitted, submits to **all unlisted** directories automatically
- Creates `citation_submissions` rows for each (status: `pending`)
- Calls BrightLocal's submission API which queues the submissions
- Returns `{ submitted: 12, jobId: "bl-12345" }`

**`GET /api/citations/submissions?locationId=`**

Lists all submissions with status tracking:
```json
{
  "submissions": [
    {
      "directory": "Apple Maps",
      "status": "live",
      "listingUrl": "https://maps.apple.com/...",
      "submittedAt": "2026-04-15T00:00:00Z",
      "liveAt": "2026-04-22T00:00:00Z"
    },
    {
      "directory": "Bing Places",
      "status": "pending",
      "rejectionReason": null
    }
  ]
}
```

Submission statuses: `pending` → `submitted` → `live` | `rejected` | `duplicate`

### Citations Page Walkthrough

1. **Summary cards** — Listed count, Not listed count, NAP accurate count, Completeness percentage
2. **Directory grid** — Each directory shown as a card with colour-coded status (green = listed + NAP match, amber = listed + NAP mismatch, red = not listed)
3. **NAP detail popover** — Clicking a card shows which fields match vs. differ with exact listed values
4. **Submit button** — Opens a modal to select directories for submission (or submit all unlisted)
5. **Submissions tab** — Status tracker for all submissions in progress
6. **Show errors only toggle** — Filters grid to show only not-listed or NAP-mismatch entries
7. **History chart** — Line chart showing completeness % over time (30/90 day toggle)

---

## 13. Competitor Benchmarking & Gap Analysis

### Overview

Clients can track named local competitors with two layers of data:

1. **Reputation data** — Google rating and review count via Google Places API (daily sync job)
2. **Search ranking data** — where each competitor appears in SERP results for every tracked keyword, captured at zero extra cost by piggybacking on the same DataForSEO SERP calls used for client rankings

Together these power four analysis views: a competitor list with rating leaderboard, a **Keyword Battleground** table showing per-keyword competitive status across every city, a **Head-to-Head** breakdown comparing your rank vs. a single competitor per keyword, and a **Discover Keywords** tool that surfaces keywords your competitors rank for that you do not.

### How SERP-Based Competitor Tracking Works

The daily/manual rankings scan calls DataForSEO's SERP API once per keyword × location combination. Each call returns the top 30 organic results. `getSerpRanks()` scans that result set for both the client's business *and* every tracked competitor (matched by website domain). Competitor positions are stored in the `competitor_rankings` table at no additional API cost.

### Competitors API

**`GET /api/competitors`**

Returns competitor list plus the client's own review stats for comparison:

```json
{
  "competitors": [
    {
      "id": "...",
      "name": "Rival Plumbing Co.",
      "website": "https://rivalplumbing.com",
      "googlePlaceId": "ChIJ...",
      "googleRating": 4.2,
      "googleReviewCount": 87,
      "lastSyncedAt": "2026-05-01T05:00:00Z"
    }
  ],
  "clientStats": {
    "avgRating": 4.7,
    "reviewCount": 142,
    "byPlatform": [
      { "platform": "google", "avgRating": 4.8, "count": 98 }
    ]
  }
}
```

**`POST /api/competitors`**
```json
{
  "name": "Rival Plumbing Co.",
  "website": "https://rivalplumbing.com",
  "googlePlaceId": "ChIJ..."
}
```
If `googlePlaceId` is provided, an immediate sync runs to fetch their current rating. Requires team admin role.

**`GET /api/competitors/search?q=<query>`**

Proxies a Google Places Text Search and returns the top 5 results with place IDs. The query is location-biased by appending the client's primary city and state, so searching "Joe Plumbing" returns local results rather than worldwide matches.

**`POST /api/competitors/:id/sync`** — Manually refreshes a competitor's Google rating (team admin)

**`DELETE /api/competitors/:id`** — Removes competitor and all associated `competitor_rankings` rows (team admin)

### Run Scan

**`POST /api/competitors/sync-rankings`** *(team admin)*

Queues a BullMQ rankings job for the current client immediately, pulling fresh SERP data for all keywords across all locations and service-area cities. This is the same job that runs on the daily cron.

**Rate gate:** A Redis key `rankings:cooldown:{clientId}` with 86 400-second TTL is set after each scan. While the key is live, the button is disabled and shows the exact time the next scan becomes available ("Next scan tomorrow at 3:45 PM EST"). Deleting the Redis key manually opens the gate immediately.

**`GET /api/competitors/scan-status`**

Returns the current cooldown state:
```json
{ "scanning": false, "retryAfterSeconds": 74820 }
```
- `scanning: true` → a job is actively running (BullMQ queue depth > 0)
- `retryAfterSeconds` → seconds until the 24h gate expires; `0` = gate is open

The frontend polls this endpoint every 5 seconds while scanning, and every 30 seconds otherwise.

### Keyword Battleground

**`GET /api/competitors/gap`**

Returns a row for every keyword × city combination, showing your rank and the best competitor rank across all tracked competitors.

```json
{
  "rows": [
    {
      "keyword": "plumber Austin TX",
      "locationName": "Main Office",
      "area": "Austin, TX",
      "yourRank": 2,
      "bestCompetitorRank": 5,
      "bestCompetitorName": "Rival Plumbing Co.",
      "status": "winning",
      "lastChecked": "2026-05-11T06:00:00Z"
    },
    {
      "keyword": "emergency plumber",
      "locationName": "Main Office",
      "area": "Coweta, OK",
      "yourRank": 8,
      "bestCompetitorRank": 3,
      "bestCompetitorName": "QuickFix Plumbing",
      "status": "losing",
      "lastChecked": "2026-05-11T06:00:00Z"
    },
    {
      "keyword": "water heater repair",
      "locationName": "Main Office",
      "area": "Austin, TX",
      "yourRank": null,
      "bestCompetitorRank": null,
      "bestCompetitorName": null,
      "status": "uncontested",
      "lastChecked": "2026-05-11T06:00:00Z"
    }
  ],
  "competitors": [
    { "id": "...", "name": "Rival Plumbing Co.", "website": "..." }
  ]
}
```

**`area`** is the actual city+state label (e.g. `"Austin, TX"` or `"Coweta, OK"`) — the primary city comes from the location's `city`/`state` columns, and service-area cities come from the `geo_location` tag on each snapshot.

Status definitions:

| Status | Condition | Badge colour |
|---|---|---|
| `winning` | You rank and your rank ≤ best competitor rank | Green |
| `losing` | You rank and a competitor ranks better | Red |
| `uncontested` | Neither you nor any competitor rank for this keyword+city | Slate |

Rows are sortable by **Your Rank** and **Best Competitor** columns. A keyword filter input (with × clear button) lets the user narrow by keyword substring.

Implementation notes:
- Uses PostgreSQL `DISTINCT ON (keyword_id, location_id, geo_location)` ordered by `pulled_at DESC` to pick the most recent snapshot per geo combination — with `WHERE rank IS NOT NULL` on the competitor sub-query so a null-ranked row does not shadow an older ranked position.
- DataForSEO SERP calls are made for the primary city *and* up to 4 service-area cities per location; each result is tagged with `geo_location = "City, ST"` (null for the primary city).

### Head-to-Head Rankings

**`GET /api/competitors/head-to-head?competitorId=<id>`**

Returns a per-keyword comparison between the client and one specific competitor:

```json
{
  "rows": [
    {
      "keyword": "plumber Austin TX",
      "yourRank": 2,
      "competitorRank": 7,
      "delta": 5
    }
  ],
  "competitor": { "id": "...", "name": "Rival Plumbing Co." }
}
```

`delta` is positive when you rank better (lower rank number). Used by the Head-to-Head tab in the Competitors page.

### Discover Keywords

**`GET /api/competitors/:id/discover-keywords`**

Calls DataForSEO Labs `ranked_keywords/live` (US country code `2840`) to fetch up to 1 000 keywords the competitor's website currently ranks for, sorted by descending search volume. Keywords the client already tracks are filtered out, leaving only new opportunities.

```json
{
  "keywords": [
    { "keyword": "humidifier cough repair", "searchVolume": 2400 },
    { "keyword": "furnace filter replacement", "searchVolume": 1900 }
  ],
  "competitor": { "id": "...", "name": "Rival Plumbing Co.", "website": "..." }
}
```

**Implementation notes:**
- The Labs endpoint only accepts country-level location codes (`2840` for USA). DMA or state codes return a `40501` error and must not be used.
- `order_by` must be an array of strings in `"field,dir"` format: `["keyword_data.keyword_info.search_volume,desc"]`. Using nested arrays causes a `40501 Invalid Field` error.

### Competitors Page Walkthrough

**Overview tab**
1. **"Your Business" card** — avg rating, total reviews, Google-specific stats
2. **Competitor table** — each row: name, website link, Google rating (star icon), review count, visual rating bar; per-competitor sync button
3. **"Add Competitor" modal** — type a business name; location-biased Places search returns local results; select to pre-fill fields
4. **Rating leaderboard** — ranked list of all competitors + you, sorted by Google rating, colour-coded bars
5. **Run Scan button** — triggers `POST /competitors/sync-rankings`; while scanning shows a spinner; when the 24h gate is active shows "Next scan tomorrow at X:XX PM EST" and is disabled

**Keyword Battleground tab**
1. Keyword filter input (searches all keyword text; × clears)
2. Sortable columns: Keyword, Area, Your Rank (▲▼), Best Competitor (▲▼), Competitor Name, Status
3. Status badges: green (winning), red (losing), slate (uncontested)
4. Rows expand across primary city + all service-area cities

**Head-to-Head tab**
1. Competitor selector dropdown
2. Per-keyword rank comparison table with delta column

**Discover Keywords tab**
1. Competitor selector dropdown
2. Results table: keyword, monthly search volume
3. Per-keyword "Add to Location" button — single location → direct add; multiple locations → dropdown showing "Name — City, ST" labels
4. Up to 1 000 keywords returned, sorted by search volume descending

---

## 14. SEO Audit Tools

SuperLocalSEO has two distinct audit systems serving different purposes.

### 14a. Public Audit Lead Magnet (`/audit`)

A free public tool that any visitor can use without an account. Its purpose is lead generation — visitors enter their business name and city, get a partial audit, then give their email to unlock the full results.

#### How It Works

**`POST /api/audit/scan`** (public, no auth)
```json
{ "businessName": "Joe Plumbing", "city": "Austin TX", "keyword": "plumber" }
```

1. Calls Google Places API to find the business (`findBusiness`)
2. Scores the business across 5 categories (two are immediately visible, three are locked)
3. Stores an `audit_leads` row with the scan data
4. Returns `{ scanId, audit }` immediately — no account required

Scoring categories:

| Category | Max Score | Always Visible? |
|---|---|---|
| Google Business Profile | 100 | ✅ Yes |
| Reviews | 100 | ✅ Yes |
| Keyword Rankings | 100 | ❌ Locked |
| Citations & Directories | 100 | ❌ Locked |
| Competitor Benchmark | 100 | ❌ Locked |

**Google Profile scoring (100 pts):**
- Website linked: 20 pts
- 5+ photos: 20 pts (partial for 1–4)
- Hours listed: 20 pts
- 50+ reviews: 20 pts (partial for 10–49)
- Business verified operational: 20 pts

**Reviews scoring (100 pts):**
- Rating ≥ 4.7★: 60 pts | ≥ 4.3: 50 pts | ≥ 3.8: 35 pts | ≥ 3.0: 20 pts
- 100+ total reviews: 40 pts | 50+: 30 pts | 20+: 20 pts | 5+: 10 pts

Overall grade: A (90+), B (75+), C (60+), D (45+), F (<45)

**`POST /api/audit/capture`** (public, no auth)
```json
{ "scanId": "<uuid>", "email": "user@example.com" }
```

1. Saves the email to the `audit_leads` row
2. Unlocks all locked categories (details show: "Sign up to start tracking this — we monitor daily")
3. Sends `sendAuditLeadEmail` with the overall score, grade, and a link to `/register`
4. Returns the full unlocked audit

#### Audit Page Flow

1. User arrives at `/audit`
2. Enters business name + city (+ optional keyword)
3. Scanning animation runs
4. Results appear: overall grade displayed prominently, two scored categories visible, three locked with a blurred overlay
5. "Unlock your full audit" prompt — email input appears
6. User submits email → all categories unlock
7. CTA: "Get your free 14-day trial" → links to `/register`

### 14b. BrightLocal Location Audits (`/dashboard/audit`)

A deeper, BrightLocal-powered audit of a specific location. Runs monthly automatically; can also be triggered manually (30-day cooldown per location).

**`POST /api/audits/bl`**
```json
{ "locationId": "<uuid>" }
```
- Requires location to have a `brightlocal_campaign_id`
- 30-day cooldown enforced (returns 429 with `nextAllowed` date if too soon)
- Queues a BrightLocal report generation; polls for completion via job

**`GET /api/audits/bl`** — Lists all audits for the client

**`GET /api/audits/bl/:id`** — Full audit detail:
```json
{
  "locationId": "...",
  "status": "complete",
  "napScore": 82,
  "citationScore": 74,
  "reviewScore": 90,
  "googleScore": 88,
  "compositeScore": 83,
  "recommendations": [
    "Add more photos to your Google Business Profile (currently 2, aim for 10+)",
    "Inconsistent phone number on 8 directories"
  ],
  "completedAt": "2026-05-01T09:15:00Z"
}
```

**`GET /api/audits/bl/history/:locationId`** — Historical audit scores for trend analysis

#### Audit History Page Walkthrough

1. **Location selector** — dropdown to switch between locations
2. **Audit cards** — Each completed audit shows composite score, individual category scores as circular gauges
3. **Recommendations** — Prioritised action items from BrightLocal
4. **Trigger button** — "Run New Audit" — disabled with countdown if within 30-day cooldown
5. **Score history** — trend of composite score over time

---

## 15. Geo-Grid Visibility Maps

### Overview

A geo-grid shows local search rankings at a grid of geographic points around a business location. This visualises the "visibility radius" — how far out from the business address does it still rank in the local pack.

### API

**`POST /api/geo-grid`**
```json
{
  "locationId": "<uuid>",
  "keywordId": "<uuid>",
  "gridSize": 7
}
```
- `gridSize`: `7` (7×7 = 49 points) or `13` (13×13 = 169 points)
- Location must have latitude/longitude coordinates set
- Returns `202 Accepted` with `{ report }` — status will be `pending`

**`GET /api/geo-grid?locationId=&keywordId=`** — Lists reports (up to 20)

**`GET /api/geo-grid/:id`** — Full report with `gridData`:
```json
{
  "gridData": [
    { "lat": 30.2672, "lng": -97.7431, "rank": 1, "url": "https://acmeplumbing.com" },
    { "lat": 30.2800, "lng": -97.7431, "rank": 4, "url": "https://acmeplumbing.com" }
  ]
}
```

### How Geo-Grid Works

BrightLocal runs a local search at each grid point using the provided keyword. The result is the rank of the client's business at that geographic location. Grid data is rendered as a heatmap overlay on a map — green = high rank, red = low rank — giving a visual footprint of search visibility.

---

## 16. Monthly PDF Reports

### Overview

On the 1st of every month at 08:00 UTC, the system automatically generates a PDF report for every active and trialing client and delivers it by email. Clients can also trigger a manual report at any time.

### Report Sections

1. **Executive Summary** — Period (e.g. "April 2026"), overall performance indicators
2. **Keyword Rankings** — Full keyword table with rank, delta vs. prior month, and trend sparkline per keyword
3. **Reviews Summary** — Total reviews, average rating, platform breakdown, new reviews this period
4. **Citation Health** — Completeness percentage, listed vs. not-listed count
5. **Recommendations** — Actionable items generated from the data

### White-Label Reports (Pro Tier)

Pro tier (Tier 3) clients can configure custom branding:
- `whiteLabelCompanyName` — replaces "SuperLocalSEO" in the report
- `whiteLabelLogoUrl` — replaces the logo
- `whiteLabelColor` — replaces the brand colour (#hex)

All `#0052CC` colour references and "SuperLocalSEO" text in the PDF template are replaced dynamically.

### PDF Generation

Reports are generated server-side using **Puppeteer** (headless Chromium). The `renderReportHtml()` function in `report.service.ts` builds an HTML document that is then rendered to PDF.

Files are stored at `{REPORTS_DIR}/{clientId}/{year}-{month}.pdf` (default: `/tmp/reports/`).

### API

**`GET /api/reports`**

Returns all reports for the client:
```json
{
  "reports": [
    {
      "id": "...",
      "periodMonth": 4,
      "periodYear": 2026,
      "status": "sent",
      "generatedAt": "2026-05-01T08:03:21Z",
      "sentAt": "2026-05-01T08:03:45Z",
      "emailRecipient": "user@example.com"
    }
  ]
}
```

**`GET /api/reports/:id/download`** — Downloads PDF (`Content-Disposition: attachment`)

**`GET /api/reports/:id/view`** — Opens PDF inline in browser (`Content-Disposition: inline`)

**`POST /api/reports/generate`**
```json
{ "month": 4, "year": 2026 }
```
Defaults to the previous calendar month. Admins can specify `clientId` to generate for any client.

### Reports Page Walkthrough

1. **Report history table** — Each row: period, status badge (pending/generated/sent), generated date
2. **Download button** — Downloads PDF file
3. **Preview button** (eye icon) — Opens a full-screen modal with the PDF rendered inline using an authenticated blob URL (works for modern browsers; mobile shows "Open PDF" link)
4. **Generate button** — "Generate Report" triggers manual generation for the previous month

---

## 17. Platform Integrations

### Architecture

All third-party connections are stored in the `integrations` table: `client_id`, `provider`, `status`, `oauth_access_token`, `oauth_refresh_token`, `oauth_expires_at`, `api_key_encrypted`, `external_account_id`, `external_account_name`, `last_pull_at`, `error_message`.

API keys are encrypted at-rest using AES-256-GCM with the `ENCRYPTION_KEY` environment variable.

### Google Business Profile

**Connect flow:**
1. Client clicks "Connect Google Business Profile" in Settings → Integrations
2. `GET /api/integrations/google/auth-url` → returns Google OAuth URL
3. User authorises on Google consent screen
4. `GET /api/integrations/google/callback?code=&state=` — exchanges code, stores `oauth_access_token`, `oauth_refresh_token`, `oauth_expires_at`
5. Redirect to `/dashboard/settings?tab=integrations&connected=google`

**Scope:** `https://www.googleapis.com/auth/business.manage`

**Token auto-refresh:** When the access token is within 60 seconds of expiry, `syncGBPReviews()` automatically refreshes it using the refresh token and updates the DB.

**Data synced:** Reviews pulled from Google My Business API v4 (`/accounts/{accountName}/locations/{locationName}/reviews`). Star ratings mapped from `ONE`–`FIVE` strings to integers 1–5.

### Facebook Pages

**Connect flow:**
1. `GET /api/integrations/facebook/auth-url` → returns Facebook OAuth URL
2. User authorises on Facebook consent screen (scopes: `pages_read_engagement`, `pages_read_user_content`, `pages_show_list`)
3. `GET /api/integrations/facebook/callback?code=&state=` — exchanges for short-lived token, then upgrades to **long-lived token** (60-day expiry), fetches user's pages and stores first page's access token + page ID + page name
4. Redirect to `/dashboard/settings?tab=integrations&connected=facebook`

**Data synced:** Page ratings and reviews via `GET /{pageId}/ratings?fields=rating,review_text,created_time,reviewer` on Graph API v19.0.

### Google OAuth Sign-In (auth)

Separate from the GBP integration — used for passwordless account creation/login at the auth level. Scope: `openid email profile`.

### EmbedMyReviews (EMR)

Operator-configured (not client self-service). The `api_key_encrypted` field stores the client's EMR API key. Connected integrations are pulled every 6 hours.

EMR enables:
- Review aggregation across 100+ platforms
- Review request campaigns
- Private feedback gating
- Review reply sync

### BrightLocal

Operator-configured. `api_key_encrypted` stores the API key; `brightlocal_campaign_id` on each location links to the BrightLocal campaign. Enables:
- Daily keyword rankings pulls
- Daily citation status pulls
- Location audit reports
- Citation submissions
- Geo-grid visibility maps
- Yelp review monitoring (via reputation monitoring campaigns)

### Yelp

Yelp removed direct API access for reviews in 2018. Yelp review monitoring is handled automatically via BrightLocal's reputation monitoring feature when a BrightLocal campaign is active. The integrations Settings page explains this rather than showing a broken "Connect Yelp" button.

### Integrations Settings Page

The Settings → Integrations tab shows:
- **Review Management** — EMR credentials card; shows login URL, email, and auto-generated password with one-click copy buttons; includes "Open Review Management" link to `https://app.superlocalseo.com/login`. **Visible to platform admin accounts only** (`role = 'admin'` from JWT); hidden for regular client accounts.
- **Google Business Profile** — Connect/Disconnect button; status badge
- **Facebook** — Connect/Disconnect button; shows connected page name when linked
- **Yelp** — Informational card explaining BrightLocal handles Yelp monitoring

---

## 18. Team Management & RBAC

### Overview

The owner of a client account can invite additional users to access the same dashboard. Team members have either `admin` or `viewer` role.

| Role | Can Read | Can Write | Can Invite/Remove Team |
|---|---|---|---|
| Owner | ✅ | ✅ | ✅ |
| Admin (team) | ✅ | ✅ | ❌ |
| Viewer (team) | ✅ | ❌ | ❌ |

Write operations (adding competitors, posting replies, bulk-inviting, changing settings) are blocked for `viewer` team members via the `requireTeamAdmin` middleware.

### Invite Flow

1. Owner goes to Settings → Team
2. Enters email + role (Admin or Viewer)
3. `POST /api/team/invite` — generates a 48-hour invite token, sends invite email
4. Recipient receives email with accept link: `/team/accept?token=<token>`
5. Recipient clicks link → frontend calls `GET /api/team/accept?token=` to validate
6. If recipient has no account: shown a "Create Password" form
7. `POST /api/team/accept/confirm` — `{ token, password }` — creates user (if new) or links existing user, issues access token, sets refresh cookie

### API

**`GET /api/team`**
```json
{
  "owner": { "userId": "...", "email": "owner@example.com", "role": "owner" },
  "members": [
    {
      "id": "...",
      "email": "member@example.com",
      "role": "admin",
      "userId": "...",
      "accepted": true,
      "pending": false,
      "expired": false
    }
  ]
}
```

**`POST /api/team/invite`**
```json
{ "email": "colleague@example.com", "role": "admin" }
```
- Prevents inviting yourself
- Prevents duplicate active members

**`DELETE /api/team/:memberId`** — Removes member (owner only)

---

## 19. Review Widgets

### Overview

Each client has a unique **widget key** (UUID) that powers an embeddable review carousel. The widget can be embedded on any website with a single `<script>` tag.

### Embed Code

```html
<div id="sls-widget"></div>
<script src="https://superlocalseo.com/widget.js" 
        data-key="<widget-key>"
        data-theme="light"
        data-min-rating="4"
        data-max-count="8">
</script>
```

The widget fetches `GET /api/widget/<key>` (public, CORS `*`) and renders a responsive review carousel.

### Configuration

**`GET /api/widget`** — Returns current widget key and config

**`PATCH /api/widget`**
```json
{
  "theme": "light",
  "minRating": 4,
  "maxCount": 8,
  "showPlatformBadge": true
}
```

**`POST /api/widget/regenerate`** — Generates a new widget key (invalidates the old embed)

### Advanced Config

**`PATCH /api/widget/:id/config`**
```json
{
  "minRating": 3,
  "platforms": ["google", "facebook"],
  "keywordFilter": "excellent",
  "sortBy": "highest",
  "reviewCount": 12,
  "customCss": ".sls-card { border-radius: 8px; }"
}
```
- `customCss` max 10KB, no `javascript:` or `@import` allowed (XSS prevention)
- `sortBy`: `newest`, `highest`, `lowest`

### Widget Settings Page

The Settings → Widgets tab provides:
1. **Live preview** — rendered widget preview using current config (updates in real-time as you change settings before saving)
2. **Theme toggle** — light/dark
3. **Min rating slider** — hide reviews below a threshold
4. **Max count** — cap how many reviews show
5. **Platform badge** — show/hide Google/Facebook icons
6. **Embed code snippet** — copy-paste ready
7. **Regenerate key** — with confirmation prompt

---

## 20. QR Codes & NFC Review Capture

### Overview

Generate printable QR codes for physical locations. Scanning the code increments a counter and redirects to a target URL (typically the Google review link for that location). Useful for receipts, business cards, table tents, or NFC tags.

### API

**`GET /api/qr`**
```json
{
  "qrCodes": [
    {
      "id": "...",
      "name": "Counter QR",
      "shortCode": "abc12xyz",
      "targetUrl": "https://g.page/r/...",
      "scanCount": 47,
      "lastScannedAt": "2026-04-29T14:22:00Z",
      "locationName": "Downtown Branch",
      "qrUrl": "https://superlocalseo.com/qr/r/abc12xyz"
    }
  ]
}
```

**`POST /api/qr`**
```json
{
  "name": "Counter QR",
  "targetUrl": "https://g.page/r/AbCdEfGhIjKlMnOp",
  "locationId": "<uuid>"
}
```
- Generates an 8-character alphanumeric short code (avoids confusable chars: 0/O, 1/l/I)
- `targetUrl` must be `https://` or `http://`

**`GET /api/qr/:id/image`** — Returns a 400×400 PNG QR code image (cached 24 hours)

**`GET /api/qr/r/:code`** (public) — Redirect endpoint: increments scan count, `302` redirects to `targetUrl`

**`DELETE /api/qr/:id`** — Removes QR code

### QR Codes Settings Page

1. **QR code cards** — Each shows name, scan count, last scanned date, target URL
2. **Download PNG** — Downloads the QR image for print use
3. **Copy URL** — Copies the short redirect URL
4. **Create button** — Opens create form: name, target URL, optional location link

---

## 21. Reputation Management

### BrightLocal Reply Posting

For clients using BrightLocal, replies can be posted directly to Google via the BrightLocal API without leaving the dashboard.

**`POST /api/reputation/reviews/:reviewId/reply`**
```json
{ "replyText": "Thank you so much for the kind words, John!" }
```
- If `replyText` is omitted, uses the approved AI draft from `review_responses.final_body` or `draft_body`
- Updates `reviews`: `bl_reply_status = 'posted'`, `bl_reply_posted_at = now`, `replied = true`

**`POST /api/reputation/sync`**

Manually syncs BrightLocal reviews and links them to existing review records by matching author name (case-insensitive, most recent unlinked review).

### Reviews Page — Post to Google

The Reviews page has a "Post to Google" modal for each review. When clicked:
1. Shows the current AI draft (or lets user type custom reply)
2. On submit: calls `POST /api/reputation/reviews/:reviewId/reply`
3. On success: the review card updates to show "Replied ✓"

---

## 22. Billing & Subscription Management

### Trial Period

Every new account starts on a 14-day free trial:
- `subscription_status = 'trialing'`
- `trial_ends_at = created_at + 14 days`
- Full dashboard access during trial

After the trial expires, the middleware returns `402 TRIAL_EXPIRED` for all protected API calls, and the `apiFetch` client in `api.ts` automatically redirects the browser to `/billing`.

### Grace Period

When a payment fails:
- `subscription_status = 'past_due'`
- `payment_failed_at = now`
- A **3-day grace period** applies — full access continues
- After 3 days past `payment_failed_at`: middleware returns `402 PAYMENT_OVERDUE`
- A "Payment Failed" banner appears on the dashboard throughout the grace period

### Billing API

**`GET /api/billing`**

```json
{
  "tier": 1,
  "status": "trialing",
  "currentPeriodEnd": null,
  "trialEndsAt": "2026-05-14T00:00:00Z",
  "trialDaysRemaining": 13,
  "hasPaymentMethod": false,
  "paymentFailedAt": null,
  "graceDaysRemaining": null
}
```

**`POST /api/billing/checkout`**
```json
{ "tier": 2 }
```
Creates a Stripe Checkout Session and returns `{ url }`. Redirects to Stripe's hosted card-entry page. On completion, the `checkout.session.completed` webhook fires, and the system activates the subscription.

**`GET /api/billing/portal`**

Returns Stripe Customer Portal URL for self-service (update card, view invoices, cancel subscription).

**`PATCH /api/billing/change-plan`**
```json
{ "tier": 3 }
```
Changes the subscription tier immediately (prorated).

### Stripe Events Handled

| Event | Action |
|---|---|
| `checkout.session.completed` | Find client by `stripe_customer_id`, set `stripe_subscription_id`, set status `active` |
| `invoice.paid` | Set `subscription_status = 'active'`, clear `payment_failed_at` |
| `invoice.payment_failed` | Set `subscription_status = 'past_due'`, set `payment_failed_at = now`, send payment-failed email |
| `customer.subscription.deleted` | Set `subscription_status = 'canceled'` |

### Dashboard Banners & CTAs

The main Dashboard page shows contextual banners:
- **SubscribeCTA card** (shown for all trialing and canceled users): prominent dark card with "Subscribe now →" link to `/billing`. Always visible during trial.
- **Trial strip banner** (DashboardLayout, when trialing with ≤ 5 days remaining): blue → amber (≤ 3 days) → red (≤ 1 day) colour progression.
- **Past Due banner** (when `status = 'past_due'`): amber warning with Stripe portal link.

### `/billing` Page Behaviour

| User state | What they see |
|---|---|
| `active` | "Already subscribed" — link to Settings → Billing |
| `trialing`, >7 days left | Soft landing: "You're on a free trial — no payment needed yet" + "Subscribe early" opt-in |
| `trialing`, ≤7 days left | Full payment form (Stripe Elements) |
| `canceled` / expired | Full payment form |

When the full payment form is shown, `POST /api/billing/subscription-intent` is called immediately to create a Stripe subscription in `default_incomplete` state and return a `clientSecret` for the Stripe `PaymentElement`. On successful payment, the `invoice.paid` webhook activates the subscription.

### Settings → Billing Tab

1. **Status card** — Current plan ($349/mo), status badge, trial countdown or renewal date
2. **Locations summary** — Count vs. limit, extra-location surcharge warning
3. **Subscribe now** button (only when `status` is not `active` and not `trialing`) — calls `POST /api/billing/checkout` for a hosted Stripe Checkout session
4. **Manage payment & invoices** link (when `active` or `trialing`) — opens Stripe Customer Portal

---

## 23. White-Label Reports

### Availability

Pro tier (Tier 3, $1,200/mo) only. Additionally, the White-Label section in Settings → Account is only rendered for **platform admin accounts** (`role = 'admin'` from JWT) — regular client accounts do not see this UI regardless of tier.

### Configuration

In Settings → Account, the White-Label section appears for Pro clients (admin accounts only):
- **Company name** — Replaces "SuperLocalSEO" throughout the PDF
- **Logo URL** — Replaces the logo image in the PDF header
- **Brand colour** — Hex colour (`#RRGGBB`) replacing the `#0052CC` brand colour

**`PATCH /api/clients`**
```json
{
  "whiteLabelCompanyName": "Acme Digital Marketing",
  "whiteLabelLogoUrl": "https://acme.com/logo.png",
  "whiteLabelColor": "#E84040"
}
```

### How It Works

`gatherReportData()` in `report.service.ts` fetches `white_label_*` columns from the clients table. If the client is Tier 3 and any white-label fields are set, a `whiteLabel` object is passed to `renderReportHtml()`. The HTML template replaces all colour and brand references dynamically before Puppeteer renders to PDF.

---

## 24. Admin Panel

### Access

Admin role only. Set `role = 'admin'` directly in the `users` table. The Admin link appears in the dashboard sidebar (red, with a ShieldAlert icon) only for admin users. All `/api/admin/*` routes require the `requireAdmin` middleware which returns `403` for non-admin tokens.

### Overview Tab

**`GET /api/admin/overview`**

Displays real-time platform health:

- **Client stats**: total, active, trialing, past due, canceled, new this week
- **MRR**: active clients × tier price ($350/$700/$1,200)
- **Audit Leads**: total captured emails + this week
- **System health**: DB latency (ms), Redis latency (ms), both with pass/fail indicator
- **Queue health**: all 9 BullMQ queues with waiting/active/completed/failed/delayed counts
- **14-day signup sparkline**: bar chart of new registrations per day

Auto-refreshes every 30 seconds.

### Clients Tab

**`GET /api/admin/clients?page=&limit=25&search=&status=`**

Paginated table of all clients:
- Search by business name or email (ILIKE, case-insensitive)
- Filter by subscription status (active/trialing/past_due/canceled)
- Each row: business name, email, status badge, tier, trial end/period end, location count, created date

### Analytics Tab

**`GET /api/admin/analytics`**

Four datasets:
1. **New signups per month** (last 12) — `DATE_TRUNC('month', created_at)` grouping
2. **Cancellations per month** (last 12) — clients where `subscription_status = 'canceled'` grouped by `updated_at`
3. **Tier breakdown** — current count per tier (Starter/Growth/Pro)
4. **Status breakdown** — current count per status

Displayed as:
- Grouped bar chart: green bars (new clients) vs red bars (cancellations) by month
- Tier breakdown bar chart with coloured bars (blue/green/amber)
- Status breakdown badges

### Queues Tab

**`GET /api/admin/queues`**

Detailed BullMQ queue health with recent failures:
```json
{
  "queues": [
    {
      "name": "rankings",
      "waiting": 0,
      "active": 1,
      "completed": 4820,
      "failed": 2,
      "delayed": 0,
      "ok": true,
      "recentFailures": [
        {
          "id": "123",
          "name": "daily-pull",
          "failedReason": "BrightLocal API timeout",
          "finishedOn": 1714540800000
        }
      ]
    }
  ]
}
```

Shows last 5 failures per queue. Auto-refreshes every 15 seconds.

---

## 25. Background Job System

### Architecture

All background work runs through **BullMQ** on Redis. Each job type has its own named queue with a dedicated Worker. Cron jobs use BullMQ's `repeat: { pattern: '<cron>' }` option.

All workers register a shared `alertOnFail` handler — any job failure sends an email alert to the operator inbox with job name, error message, and context.

### Queue Reference

| Queue Name | Job | Cron / Trigger | Purpose |
|---|---|---|---|
| `rankings` | `daily-pull` | `0 6 * * *` | Pull rankings from DataForSEO SERP API; captures competitor ranks in the same call |
| `citations` | `daily-pull` | `0 7 * * *` | Pull citation status from BrightLocal |
| `reviews` | `periodic-pull` | `0 */6 * * *` | Sync reviews from EMR + GBP + Facebook |
| `reports` | `monthly-reports` | `0 8 1 * *` | Fan out to generate reports for all clients |
| `reports` | `generate-report` | On-demand | Generate PDF for a single client |
| `competitors` | `daily-sync` | `0 5 * * *` | Sync competitor Google ratings |
| `audits` | `monthly-fan-out` | `0 9 1 * *` | Trigger BL audits for all clients |
| `audits` | `poll-pending` | `*/5 * * * *` | Poll pending BrightLocal report statuses |
| `geo-grid` | `poll-pending` | `*/5 * * * *` | Poll pending geo-grid report statuses |
| `citation-builder` | `poll-status` | `0 */4 * * *` | Poll citation submission statuses |
| `trial-reminder` | `daily-check` | `0 10 * * *` | Send 3-day trial warning emails |

### Job Failure Alerting

Every worker has:
```typescript
worker.on('failed', alertOnFail(jobName))
```

`alertOnFail` sends a `sendJobFailureAlert` email to the operator with:
- Subject: `[SuperLocalSEO] Job failure: {jobName}`
- Body: job name, error message, full JSON context, timestamp

### Starting Workers

Workers start via `startWorkers()` called from the API entrypoint. All 11 workers initialise at boot.

---

## 26. Email System

All transactional emails are sent via **Resend** from `hello@superlocalseo.com`.

### Email Templates

| Trigger | Subject | Content |
|---|---|---|
| Registration | "Verify your SuperLocalSEO account" | Email verification link (expires 24hr) |
| Registration | "Welcome to SuperLocalSEO, {businessName}!" | Next steps (add location, set keywords, connect GBP), dashboard link |
| Forgot password | "Reset your SuperLocalSEO password" | Reset link (expires 1hr) |
| Trial expiring (3 days out) | "Your SuperLocalSEO trial ends in 3 days" | Days remaining, billing CTA |
| Payment failed | "Action required: Payment failed for {businessName}" | Update payment method link |
| Monthly report | "Your {period} SEO Report — {businessName}" | PDF attachment, period summary |
| Team invite | "You've been invited to join {businessName} on SuperLocalSEO" | Accept link (48hr token), role |
| Audit lead capture | "Your free SEO audit for {businessName} is ready" | Overall score/grade, register CTA |
| Job failure (operator) | "[SuperLocalSEO] Job failure: {jobName}" | Error details for operator debugging |

### Trial Reminder Job Logic

Queries clients where:
- `subscription_status = 'trialing'`
- `stripe_subscription_id IS NULL` (hasn't subscribed yet)
- `trial_ends_at` between `now + 3 days` and `now + 4 days`

Sends one email per qualifying client. The 1-day window prevents duplicates on consecutive job runs.

---

## 27. Database Schema

### Core Tables

**`users`**
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | gen_random_uuid() |
| email | VARCHAR(255) UNIQUE | |
| password_hash | TEXT | Nullable (Google OAuth users) |
| role | VARCHAR(50) | 'client' or 'admin' |
| stripe_customer_id | VARCHAR(255) | |
| email_verified | BOOLEAN | Default false |
| google_id | VARCHAR(255) UNIQUE | Google OAuth |
| created_at, updated_at | TIMESTAMP | |

**`clients`**
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| user_id | UUID FK → users | |
| business_name | VARCHAR(255) | |
| industry | VARCHAR(100) | |
| subscription_tier | INTEGER | 1/2/3 |
| subscription_status | VARCHAR(50) | active/trialing/past_due/canceled |
| stripe_subscription_id | VARCHAR(255) | |
| stripe_customer_id | VARCHAR(255) | |
| subscription_current_period_end | TIMESTAMP | |
| trial_ends_at | TIMESTAMP | registration + 14 days |
| payment_failed_at | TIMESTAMP | |
| onboarding_step | INTEGER | 0–4 |
| emr_provisioning_status | VARCHAR(50) | |
| widget_key | UUID | Auto-generated |
| widget_config | JSONB | |
| roi_config | JSONB | { avgCustomerValue, conversionRate } |
| white_label_company_name | VARCHAR(255) | Pro tier |
| white_label_logo_url | TEXT | Pro tier |
| white_label_color | VARCHAR(7) | #RRGGBB, Pro tier |
| created_at, updated_at | TIMESTAMP | |

**`locations`**
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| client_id | UUID FK → clients CASCADE | |
| name | VARCHAR(255) | |
| address, city, state, zip | VARCHAR | |
| phone, website | VARCHAR | |
| is_primary | BOOLEAN | Default false |
| brightlocal_campaign_id | VARCHAR(255) | Required for BL features |
| lat, lng | DECIMAL | For geo-grid |

**`keywords`**
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| location_id | UUID FK → locations CASCADE | |
| keyword | VARCHAR(255) | UNIQUE per location |
| monthly_search_volume | INTEGER | Nullable |

**`ranking_snapshots`**
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| keyword_id | UUID FK → keywords CASCADE | |
| location_id | UUID FK → locations CASCADE | |
| rank | INTEGER | Nullable (not found) |
| url_ranked | VARCHAR(2000) | URL that ranked |
| search_engine | VARCHAR(50) | google/bing |
| rank_type | VARCHAR(50) | organic/local_pack/paid |
| pulled_at | TIMESTAMP | |

Index: `(keyword_id, location_id, pulled_at DESC)` for trend queries.

**`reviews`**
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| client_id | UUID FK → clients CASCADE | |
| location_id | UUID FK → locations | Nullable |
| platform | VARCHAR(50) | google/facebook/yelp/etc |
| external_review_id | VARCHAR(255) | Platform's review ID |
| author_name | VARCHAR(255) | |
| rating | INTEGER | 1–5 |
| body | TEXT | |
| sentiment | VARCHAR(50) | positive/neutral/negative |
| status | VARCHAR(50) | new/responded/ignored |
| review_date | TIMESTAMP | |
| ingested_at | TIMESTAMP | |
| platform_url | TEXT | |
| replied | BOOLEAN | |
| reply_date | TIMESTAMP | |
| emr_reply_text | TEXT | |
| hidden | BOOLEAN | |
| avatar_url | TEXT | |
| verified | BOOLEAN | |
| bl_review_id | VARCHAR(255) | BrightLocal review ID |
| bl_reply_status | VARCHAR(50) | posted/failed |
| bl_reply_posted_at | TIMESTAMP | |

UNIQUE constraint: `(client_id, platform, external_review_id)`

**`citation_snapshots`**
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| location_id | UUID FK → locations CASCADE | |
| directory | VARCHAR(255) | Directory name |
| listed | BOOLEAN | |
| nap_match | BOOLEAN | |
| listing_url | TEXT | |
| nap_name_match | BOOLEAN | |
| nap_address_match | BOOLEAN | |
| nap_phone_match | BOOLEAN | |
| listed_name, listed_address, listed_phone | VARCHAR | Actual data on directory |
| pulled_at | TIMESTAMP | |

**`integrations`**
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| client_id | UUID FK → clients CASCADE | |
| provider | VARCHAR(50) | google/facebook/brightlocal/embedmyreviews |
| status | VARCHAR(50) | connected/disconnected |
| api_key_encrypted | TEXT | AES-256-GCM encrypted |
| oauth_access_token | TEXT | |
| oauth_refresh_token | TEXT | |
| oauth_expires_at | TIMESTAMP | |
| external_account_id | VARCHAR(255) | e.g. Facebook page ID |
| external_account_name | VARCHAR(255) | e.g. Facebook page name |
| last_pull_at | TIMESTAMP | |
| error_message | TEXT | Last error from sync |

UNIQUE: `(client_id, provider)`

**`competitors`**
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| client_id | UUID FK → clients CASCADE | |
| name | VARCHAR(255) | |
| website | VARCHAR(2000) | Required for SERP-based rank tracking |
| google_place_id | VARCHAR(255) | |
| google_rating | DECIMAL(3,1) | |
| google_review_count | INTEGER | |
| last_synced_at | TIMESTAMP | |

**`competitor_rankings`**
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| competitor_id | UUID FK → competitors CASCADE | |
| keyword_id | UUID FK → keywords CASCADE | |
| location_id | UUID FK → locations CASCADE | |
| rank | INTEGER | Null = not in top 30 |
| url | VARCHAR(2000) | URL that ranked |
| search_engine | VARCHAR(50) | `google` |
| geo_location | VARCHAR(255) | Null = primary city; `"City, ST"` = service area |
| pulled_at | TIMESTAMP | |

Competitor rankings are captured at zero extra API cost — the same DataForSEO SERP call used for client rankings scans the top 30 results for any tracked competitor domain. Migration: `20260511040000_competitor_rankings_geo`.

**`reports`**
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| client_id | UUID FK → clients CASCADE | |
| period_month, period_year | INTEGER | |
| status | VARCHAR(50) | pending/generated/sent |
| file_path | TEXT | Absolute path on disk |
| generated_at, sent_at | TIMESTAMP | |
| email_recipient | VARCHAR(255) | |

**`team_members`**
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| client_id | UUID FK → clients CASCADE | |
| email | VARCHAR(255) | |
| role | VARCHAR(50) | admin/viewer |
| user_id | UUID FK → users | Null until accepted |
| invited_by | UUID FK → users | |
| invite_token | VARCHAR(255) | UUID, null after accept |
| invite_expires_at | TIMESTAMP | +48 hours from invite |
| accepted_at | TIMESTAMP | |

**`audit_leads`**
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| business_name | VARCHAR(255) | |
| city | VARCHAR(255) | |
| keyword | VARCHAR(255) | Nullable |
| email | VARCHAR(255) | Null until capture |
| audit_data | JSONB | Full audit result |
| google_place_id | VARCHAR(255) | |
| converted_at | TIMESTAMP | Set when registers |

**`review_responses`**
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| review_id | UUID FK → reviews CASCADE | UNIQUE |
| draft_body | TEXT | AI-generated |
| final_body | TEXT | User-edited |
| status | VARCHAR(50) | draft/approved |
| approved_at | TIMESTAMP | |

**`qr_codes`**
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| client_id | UUID FK → clients CASCADE | |
| location_id | UUID FK → locations | Nullable |
| name | VARCHAR(255) | |
| short_code | VARCHAR(8) UNIQUE | |
| target_url | TEXT | |
| scan_count | INTEGER | Default 0 |
| last_scanned_at | TIMESTAMP | |

**`geo_grid_reports`**
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| location_id | UUID FK → locations CASCADE | |
| keyword_id | UUID FK → keywords CASCADE | |
| status | VARCHAR(50) | pending/complete/failed |
| grid_size | INTEGER | 7 or 13 |
| center_lat, center_lng | DECIMAL | |
| grid_data | JSONB | Array of { lat, lng, rank, url } |
| completed_at | TIMESTAMP | |

---

## 28. Security Model

### Authentication Security

- **JWT access tokens**: 15-minute expiry, signed with `JWT_SECRET`
- **JWT refresh tokens**: 7-day expiry, `httpOnly` cookie, signed with `JWT_REFRESH_SECRET`, blocklisted in Redis on logout
- **Password hashing**: bcrypt, cost factor 10
- **Email verification**: required before login is permitted

### API Security

- **Rate limiting**: General API: 100 req/15min. Auth endpoints: 20 req/15min. AI responses: 20 req/10min. Uses `express-rate-limit`.
- **Request validation**: All inputs validated with Zod schemas before reaching controllers. Invalid requests return `422` with field-level error details.
- **CORS**: Configured to allow only the application's own origin (except `/api/widget/:key` which uses `*` for public widget embedding)
- **Body size limit**: Applied via Express `json()` middleware to prevent payload attacks
- **SQL injection**: Knex.js parameterised queries throughout — no raw string interpolation into queries
- **XSS**: Widget `customCss` field sanitised — `javascript:` and `@import` patterns rejected
- **Open redirect**: OAuth callbacks validate the `state` parameter; no external URL redirection from callback handlers
- **HMAC validation**: Webhook payloads (Stripe, EmbedMyReviews) validated with timing-safe `crypto.timingSafeEqual()` comparisons

### Data Isolation

Every authenticated API call goes through `requireClient` middleware which:
1. Looks up the user's associated `clients` row
2. Attaches `req.clientId` and `req.client` to the request
3. All subsequent DB queries filter by `client_id = req.clientId`

Client A cannot access Client B's data — any attempt to access a resource with another client's ID returns `404` (not `403`) to avoid resource enumeration.

### Billing Access Control

`checkBillingAccess()` in `requireClient.ts` runs after the client record is loaded:
- `trialing` + `trial_ends_at` has passed → `402 TRIAL_EXPIRED`
- `canceled` → `402 SUBSCRIPTION_CANCELED`
- `past_due` + `payment_failed_at` > 3 days ago → `402 PAYMENT_OVERDUE`

Billing-exempt paths (billing portal, auth, health): `['/billing', '/auth', '/health', '/clients']`

The frontend `apiFetch` service intercepts any `402` response with these codes and redirects to `/dashboard/settings?tab=billing`.

### Encryption

API keys stored in the `integrations` table are encrypted at-rest using AES-256-GCM with the `ENCRYPTION_KEY` environment variable. Decryption happens in-process at query time.

---

## 29. QA & Testing

### Automated Test Suite

Located in `backend/src/__tests__/`:

| File | Coverage |
|---|---|
| `health.test.ts` | `GET /api/health/live` returns 200 |
| `auth.test.ts` | Registration validation, login rejection |
| `access-control.test.ts` | Client data isolation (Client A cannot read Client B's reviews) |
| `rate-limiting.test.ts` | Auth limiter triggers after threshold |
| `webhook-security.test.ts` | HMAC validation on Stripe and EMR webhooks |

Run with: `cd backend && npm test`

Configured with:
- `jest` + `ts-jest`
- `supertest` for HTTP assertions
- Real DB (Knex migrations run against test DB in `beforeAll`)
- Coverage threshold: 70% branches/functions/lines/statements

### Smoke Test Script

`scripts/qa.sh` — Portable bash script (requires only `curl` and `jq`) that performs 42+ checks against a running server.

```bash
# Against local dev server
bash scripts/qa.sh

# Against production
BASE_URL=https://superlocalseo.com bash scripts/qa.sh

# With admin checks enabled
BASE_URL=https://superlocalseo.com \
  ADMIN_EMAIL=admin@you.com \
  ADMIN_PASSWORD=yourpassword \
  bash scripts/qa.sh

# Skip rate-limit probe (for consecutive runs within 15min)
SKIP_RATE_LIMIT_TEST=1 bash scripts/qa.sh
```

**Sections covered:**
1. Infrastructure (health endpoints, DB, Redis, TLS/HSTS on https)
2. Authentication (registration, login, token validation, wrong password rejection, auth guard)
3. Client & onboarding (client record, location creation, keyword creation)
4. Core data endpoints (reviews, rankings, citations, competitors, reports, campaigns, team, history, gap)
5. Billing (status endpoint, Stripe portal URL)
6. Analytics (rankings history, reviews trend, ROI)
7. Public endpoints (audit scan + capture, widget endpoint)
8. Security (rate limiting, open redirect, SQL injection probe, CORS)
9. Admin endpoints (role guard, overview/clients/queues/analytics if ADMIN_EMAIL set)
10. Integrations (list, Google auth URL, Facebook auth URL)
11. Webhooks (Stripe HMAC rejection, EMR HMAC rejection)
12. Cleanup (deletes QA test data)

Exit code: `0` = all pass, `1` = any failures.

### Load Testing

`tests/k6/load-test.js` — k6 script for load testing:
```bash
k6 run --vus 50 --duration 60s tests/k6/load-test.js
```

Thresholds:
- `http_req_duration`: p95 < 2000ms
- `http_req_failed`: rate < 1%

Set `TEST_EMAIL` and `TEST_PASSWORD` env vars for authenticated endpoint testing.

### E2E Tests

`tests/cypress/e2e/critical-paths.cy.ts` — Cypress E2E suite covering:
- Register → verify email → login
- Onboarding wizard
- Dashboard navigation
- Report generation and download
- Settings updates

### CI Pipeline

`.github/workflows/ci.yml` runs on every push and PR to `main`:
- **Backend job**: `npm ci` → `tsc --noEmit` → `jest --passWithNoTests --forceExit`
- **Frontend job**: `npm ci` → `tsc --noEmit` → `npm run build`

---

## 30. Deployment & Environment Configuration

### Environment Variables

**Required — server will not start without these:**

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | Access token signing key (32+ random bytes) |
| `JWT_REFRESH_SECRET` | Refresh token signing key (32+ random bytes) |
| `ENCRYPTION_KEY` | AES-256-GCM key for API key encryption (32+ random bytes) |
| `STRIPE_SECRET_KEY` | Stripe API key (`sk_live_…` in production) |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (`pk_live_…`) |
| `RESEND_API_KEY` | Resend API key |

**Required for full functionality:**

| Variable | Purpose |
|---|---|
| `STRIPE_TIER1_PRICE_ID` | Stripe price ID for Tier 1 subscription |
| `STRIPE_TIER2_PRICE_ID` | Stripe price ID for Tier 2 subscription |
| `STRIPE_TIER3_PRICE_ID` | Stripe price ID for Tier 3 subscription |
| `STRIPE_TIER1_EXTRA_LOCATION_PRICE_ID` | Extra location add-on price (Tier 1) |
| `STRIPE_TIER2_EXTRA_LOCATION_PRICE_ID` | Extra location add-on price (Tier 2) |
| `STRIPE_TIER3_EXTRA_LOCATION_PRICE_ID` | Extra location add-on price (Tier 3) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret from Stripe dashboard |
| `BRIGHTLOCAL_API_KEY` | BrightLocal API key |
| `EMBEDMYREVIEWS_API_KEY` | EmbedMyReviews API key |
| `EMBEDMYREVIEWS_WEBHOOK_SECRET` | EMR webhook signing secret |

**Optional — features degrade gracefully without these:**

| Variable | Purpose | Default |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Google OAuth (GBP connect + sign-in) | — |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret | — |
| `GOOGLE_PLACES_API_KEY` | Places API (audit scan, competitor search) | — |
| `FACEBOOK_APP_ID` | Facebook OAuth (page review sync) | — |
| `FACEBOOK_APP_SECRET` | Facebook OAuth secret | — |
| `ANTHROPIC_API_KEY` | Claude Haiku for AI review response drafts | — |
| `SENTRY_DSN` | Error tracking | — (no-op) |
| `RESEND_FROM_EMAIL` | Sender address | `hello@superlocalseo.com` |
| `RESEND_FROM_NAME` | Sender display name | `SuperLocalSEO` |
| `NODE_ENV` | Environment | `development` |
| `PORT` | API port | `3000` |
| `APP_URL` | Base URL for OAuth redirects | `http://localhost:5173` |
| `PUBLIC_URL` | Base URL for email links | `http://localhost:5173` |
| `REPORTS_DIR` | PDF storage directory | `/tmp/reports` |
| `JWT_ACCESS_EXPIRY` | Access token lifetime | `15m` |
| `JWT_REFRESH_EXPIRY` | Refresh token lifetime | `7d` |

### Generating Secrets

```bash
# JWT and encryption keys
openssl rand -hex 32   # for JWT_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY
```

### Docker Compose

The production setup uses `docker-compose.yml` (or a prod variant) with services:
- `api` — Node.js Express server
- `web` — Nginx serving compiled React frontend + proxying `/api` to `api:3000`
- `postgres` — PostgreSQL
- `redis` — Redis

### Migration

Run on first deployment (and after each release that includes new migrations):
```bash
docker compose exec api npx knex migrate:latest
```

Pending migrations as of current build (must be run on a fresh DB):
- `20260503050000_white_label_reports` — adds white-label columns to clients
- `20260503060000_trial_ends_at` — adds `trial_ends_at` to clients, back-fills existing rows
- `20260504000000_integrations_oauth_columns` — adds OAuth token columns + `external_account_id/name` to integrations

### Go-Live Checklist Summary

1. ✅ VPS: ≥ 4GB RAM, ≥ 2 vCPU, Docker + Docker Compose installed
2. ✅ DNS: `superlocalseo.com` A record → VPS IP; Cloudflare Full (strict) SSL
3. ✅ Env: All required variables populated in `.env.prod`; `NODE_ENV=production`
4. ✅ Stripe: Live mode activated; webhook endpoint registered at `https://superlocalseo.com/webhooks/stripe`; live price IDs in env
5. ✅ Resend: `superlocalseo.com` domain verified (SPF + DKIM); `hello@superlocalseo.com` sender verified
6. ✅ Google OAuth: Consent screen published (not test mode); `https://superlocalseo.com` in authorised origins; callback URI `https://superlocalseo.com/api/auth/google/callback` authorised
7. ✅ Migrations: `docker compose exec api npx knex migrate:latest`
8. ✅ Backups: `scripts/backup-db.sh` cron active (`0 2 * * *`)
9. ✅ QA: `bash scripts/qa.sh` passes all checks

---

---

## Pending Features (requires Google Business Profile API access)

The following sections are stubbed in the UI but not yet functional:

- **Review Request Campaigns** — campaign management and bulk invite UI is built; full send flow requires verified Google Business API access.
- **Reviews (GBP sync)** — review ingestion via Google My Business API v4 is implemented but requires an approved OAuth app with `business.manage` scope.
- **SEO Audit (GBP scoring)** — the GBP health scoring section of the in-dashboard audit requires GBP API access for accurate data.

These will be enabled once the `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` credentials are approved for the `business.manage` scope in Google Cloud Console.

---

*Last updated: 2026-05-11. Competitor benchmarking section fully rewritten to reflect DataForSEO SERP-based competitor rank tracking, Keyword Battleground, Head-to-Head, Discover Keywords, and Run Scan with 24h cooldown. Commit `8e92856` and follow-on fixes.*
