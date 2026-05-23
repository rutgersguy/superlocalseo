# SuperLocalSEO — REST API Reference

**Base URL:** `https://superlocalseo.com/api`  
**Content-Type:** `application/json` (all requests/responses unless noted)  
**Auth:** Bearer token in `Authorization` header, obtained from `/auth/login`. Tokens expire after 15 minutes; use `/auth/refresh` to rotate silently.

---

## Response envelope

All endpoints return a consistent envelope:

```json
{ "success": true, "data": { ... } }
{ "success": false, "error": { "message": "...", "code": "ERROR_CODE" } }
```

### Common error codes

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body/query failed schema validation |
| `UNAUTHORIZED` | 401 | Missing or expired token |
| `FORBIDDEN` | 403 | Authenticated but insufficient role |
| `NOT_FOUND` | 404 | Resource not found or not owned by caller |
| `COOLDOWN` | 429 | Rate limit or cooldown window active |
| `TRIAL_EXPIRED` | 402 | Trial ended, payment required |
| `PAYMENT_FAILED` | 402 | Active subscription but payment failed |
| `SUBSCRIPTION_CANCELLED` | 402 | Subscription cancelled |

---

## Auth

### `POST /auth/register`
Public. Rate-limited (10 req/15 min per IP).

**Body:**
```json
{ "email": "owner@example.com", "password": "Secure123!", "businessName": "Acme Plumbing" }
```

**Response 201:**
```json
{ "success": true, "data": { "message": "Verification email sent" } }
```

---

### `POST /auth/login`
Public. Rate-limited.

**Body:**
```json
{ "email": "owner@example.com", "password": "Secure123!" }
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ...",
    "user": { "id": "uuid", "email": "...", "role": "client" }
  }
}
```
Sets `refreshToken` as an httpOnly cookie (7-day expiry).

---

### `POST /auth/refresh`
Public. Reads `refreshToken` from cookie.

**Response 200:**
```json
{ "success": true, "data": { "accessToken": "eyJ..." } }
```
Issues a new refresh token cookie (one-time use rotation).

---

### `POST /auth/logout`
Public. Clears the refresh token cookie and invalidates the token in Redis.

---

### `GET /auth/verify?token=<email-verification-token>`
Public. Marks the user's email as verified.

---

### `POST /auth/password-reset/request`
Public. Rate-limited.

**Body:** `{ "email": "owner@example.com" }`

---

### `POST /auth/password-reset/confirm`
Public. Rate-limited.

**Body:** `{ "token": "...", "password": "NewSecure123!" }`

---

### `GET /auth/google`
Public. Redirects to Google OAuth consent screen.

---

### `GET /auth/google/callback`
Public. OAuth callback — exchanges code, creates/links user, sets cookie, redirects to dashboard.

---

## Clients

All routes require `Authorization: Bearer <token>`.

### `GET /clients`
Returns the authenticated client's profile, industry, subscription status, and integration connections.

**Response:**
```json
{
  "success": true,
  "data": {
    "client": {
      "id": "uuid",
      "businessName": "Acme Plumbing",
      "industry": "plumbing",
      "subscriptionTier": 1,
      "subscriptionStatus": "trialing",
      "trialEndsAt": "2026-05-26T00:00:00Z",
      "onboardingStep": 4,
      "emrAccountId": "...",
      "emrApiKey": "..."
    }
  }
}
```

---

### `PATCH /clients`
**Requires:** team admin role.

**Body (all fields optional):**
```json
{ "businessName": "Acme Plumbing Inc", "industry": "plumbing", "website": "https://acme.com" }
```

---

### `POST /clients/complete-onboarding`
**Requires:** team admin. Marks onboarding complete; triggers EmbedMyReviews account provisioning; enqueues citation scan and initial rankings pull (both non-fatal — onboarding succeeds even if queues are unavailable).

---

### `POST /clients/retry-emr-provision`
**Requires:** team admin. Retries EMR provisioning if the initial attempt failed.

---

## Locations

### `GET /locations`
Returns all locations for the authenticated client.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Main Branch",
      "address": "123 Main St",
      "city": "Austin",
      "state": "TX",
      "zip": "78701",
      "phone": "512-555-0100",
      "website": "https://acme.com",
      "isPrimary": true,
      "coordinates": { "lat": 30.27, "lng": -97.74 },
      "serviceArea": ["Austin, TX", "Round Rock, TX"]
    }
  ]
}
```

---

### `POST /locations`
**Requires:** team admin.

**Body:**
```json
{
  "name": "North Branch",
  "address": "456 Oak Ave",
  "city": "Austin",
  "state": "TX",
  "zip": "78750",
  "phone": "512-555-0200",
  "website": "https://acme.com/north",
  "isPrimary": false
}
```

---

### `PATCH /locations/:id`
**Requires:** team admin. Partial updates — any field from `POST /locations`.

---

### `DELETE /locations/:id`
**Requires:** team admin. Soft-deletes location and all associated data.

---

### `POST /locations/:id/provision`
**Requires:** team admin. Provisions the location's BrightLocal campaign (if credentials configured).

---

## Keywords

Subscription-gated.

### `GET /keywords?locationId=<uuid>`
Returns all keywords tracked for a location.

**Response:**
```json
{
  "success": true,
  "data": {
    "keywords": [
      { "id": "uuid", "keyword": "plumber near me", "locationId": "uuid", "monthlySearchVolume": 1900 }
    ]
  }
}
```

---

### `POST /keywords`
**Requires:** team admin.

**Body:**
```json
{ "locationId": "uuid", "keyword": "emergency plumber austin" }
```

---

### `PATCH /keywords/:id/volume`
**Requires:** team admin. Manually update monthly search volume.

**Body:** `{ "monthlySearchVolume": 2400 }`

---

### `DELETE /keywords/:id`
**Requires:** team admin. Removes keyword and all ranking snapshots.

---

## Rankings

Subscription-gated.

### `GET /rankings?locationId=<uuid>&days=30`
Latest ranking snapshot per keyword for a location, with optional trend data.

**Query params:**
| Param | Type | Default | Description |
|---|---|---|---|
| `locationId` | uuid | required | Filter to a specific location |
| `days` | int | 30 | Number of days of trend data to include |

**Response:**
```json
{
  "success": true,
  "data": {
    "rankings": [
      {
        "keywordId": "uuid",
        "keyword": "plumber near me",
        "rank": 4,
        "prevRank": 7,
        "delta": 3,
        "rankType": "organic",
        "urlRanked": "https://acme.com/",
        "pulledAt": "2026-05-12T06:00:00Z"
      }
    ]
  }
}
```

---

### `GET /rankings/trend?locationId=<uuid>&keywordId=<uuid>&days=90`
Historical rank series for a specific keyword.

---

### `POST /rankings/sync`
**Requires:** team admin. Queues an immediate ranking pull (subject to 24h cooldown).

---

## Reviews

Subscription-gated.

### `GET /reviews?locationId=<uuid>&platform=google&rating=1&status=new&page=1&limit=25`

**Query params:**
| Param | Type | Description |
|---|---|---|
| `locationId` | uuid | Filter to a location |
| `platform` | string | `google`, `yelp`, `facebook`, etc. |
| `rating` | int | 1–5 |
| `status` | string | `new`, `responded`, `archived` |
| `q` | string | Full-text search on review body |
| `page` | int | Default 1 |
| `limit` | int | Default 25, max 100 |

---

### `GET /reviews/feedback`
Returns reviews that were directed to the private feedback form (via EMR smart gating).

---

### `GET /reviews/:id/response`
Returns the current response draft and approval state for a review.

---

### `POST /reviews/:id/response/draft`
Generates an AI response draft via Claude. Rate-limited (20 req/10 min per user).

**Body:** `{ "tone": "professional" }` (optional)

**Response:**
```json
{ "success": true, "data": { "draft": "Thank you for your kind review, Sarah!..." } }
```

---

### `PATCH /reviews/:id/response`
Save/update the response text and status.

**Body:** `{ "responseText": "...", "status": "approved" }`

---

### `POST /reviews/webhook`
Public. Called by EmbedMyReviews in real-time. Validates HMAC-SHA256 signature (`X-EMR-Signature` header). Body is raw JSON.

---

## Citations

Subscription-gated.

### `GET /citations?locationId=<uuid>&listed=true`
Returns all citation snapshots for a location.

**Response:**
```json
{
  "success": true,
  "data": {
    "citations": [
      {
        "directory": "yelp",
        "listed": true,
        "napNameMatch": true,
        "napAddressMatch": false,
        "napPhoneMatch": true,
        "listingUrl": "https://yelp.com/biz/...",
        "pulledAt": "2026-05-12T06:00:00Z"
      }
    ]
  }
}
```

---

### `GET /citations/history?locationId=<uuid>&days=90`
Historical citation completeness score over time.

---

### `GET /citations/submissions`
Returns all citation submission jobs and their status.

---

### `GET /citations/credits`
Returns remaining BrightLocal Citation Builder credits.

---

### `POST /citations/campaign`
Creates a new BrightLocal citation submission campaign. **Requires:** team admin.

**Body:** `{ "locationId": "uuid" }`

---

### `GET /citations/campaign/:campaignId/lookup`
Returns directory match preview for a campaign before confirming.

---

### `POST /citations/campaign/:campaignId/confirm`
Confirms and submits a campaign. **Requires:** team admin.

---

### `GET /citations/campaign/:campaignId`
Returns campaign status and per-directory submission progress.

---

## Competitors

Subscription-gated.

### `GET /competitors`
Returns all tracked competitors and the client's own aggregate rating stats.

---

### `POST /competitors`
**Requires:** team admin. Adds a competitor.

**Body:**
```json
{ "name": "Rival Plumbing", "website": "https://rival.com", "googlePlaceId": "ChIJ..." }
```

---

### `DELETE /competitors/:id`
**Requires:** team admin.

---

### `POST /competitors/:id/sync`
**Requires:** team admin. Refreshes competitor's Google rating.

---

### `GET /competitors/search?q=rival+plumbing&city=Austin&state=TX`
Google Places search biased to the client's city. Used for the competitor add modal.

---

### `GET /competitors/gap?locationId=<uuid>`
Keyword Battleground — for each keyword × city combination, returns competitive status: `winning`, `competing`, `vulnerable`, or `absent`.

---

### `GET /competitors/head-to-head?competitorId=<uuid>&locationId=<uuid>`
Side-by-side rank comparison for every keyword against one competitor.

---

### `GET /competitors/scan-status`
Returns whether a competitor ranking scan is active and when the next scan is available.

---

### `POST /competitors/sync-rankings`
**Requires:** team admin. Queues an immediate competitor SERP scan.

---

### `GET /competitors/:id/discover-keywords`
Returns up to 1,000 keywords the competitor ranks for, sorted by monthly search volume. Powered by DataForSEO Labs.

---

## Analytics

Subscription-gated.

### `GET /analytics/rankings/history?locationId=<uuid>&from=2026-01-01&to=2026-05-01`
Ranking snapshots for arbitrary date ranges.

---

### `GET /analytics/reviews/trend?locationId=<uuid>&days=90`
Review volume and sentiment breakdown as a time series.

---

### `GET /analytics/citations/trend?locationId=<uuid>&days=90`
Citation completeness score over time.

---

### `GET /analytics/export?type=rankings&locationId=<uuid>`
CSV download. `type` can be `rankings`, `reviews`, `citations`.

---

### `GET /analytics/roi`
Returns estimated ROI based on configured revenue-per-lead and keyword ranking improvements.

---

### `PATCH /analytics/roi-config`
**Requires:** team admin. Update ROI configuration (average lead value, close rate, etc.)

---

## Metrics

### `GET /metrics`
Returns dashboard summary cards: avg rank, top-10 count, review volume, avg rating, citation score.

### `GET /metrics/visibility`
Returns a composite visibility score combining rankings, citations, and reviews.

### `GET /metrics/prom`
**Admin only.** Prometheus metrics endpoint for scraping.

---

## SEO Audit (Location Audits)

Subscription-gated.

### `POST /audits/bl/generate`
Triggers a new audit for a location (24h cooldown).

**Body:** `{ "locationId": "uuid" }`

**Response 202:**
```json
{
  "success": true,
  "data": {
    "audit": { "id": "uuid", "status": "processing", "createdAt": "..." }
  }
}
```

---

### `GET /audits/bl`
Returns all audits for the authenticated client (all locations, all statuses).

---

### `GET /audits/bl/location/:locationId/history`
Returns completed audits for a specific location in chronological order.

---

### `GET /audits/bl/:id`
Returns a single audit by ID.

**Response includes:**
```json
{
  "id": "uuid",
  "status": "complete",
  "onPageScore": 80,
  "onPageDetails": ["Site served over HTTPS", "Title tag: ... (optimal length)", "..."],
  "dfsLighthouseTaskId": "abc-123",
  "dfsOnPageData": {
    "performanceScore": 72,
    "accessibilityScore": 88,
    "bestPracticesScore": 95,
    "seoScore": 90,
    "lcp": 2800,
    "cls": 0.05,
    "tbt": 150,
    "categoryAudits": { "performance": [...], "accessibility": [...], ... }
  },
  "completedAt": "2026-05-12T06:31:00Z"
}
```

---

### `GET /audits/bl/:id/report`
Generates and streams a PDF audit report on demand. Content-Type: `application/pdf`.

---

## Public Lead Capture Audit

Rate-limited (5 req/hr per IP in production).

### `POST /audit/scan`
Public. Runs a quick on-page audit for a business using Google Places data. Used on the lead-capture landing page.

**Body:**
```json
{ "businessName": "Acme Plumbing", "city": "Austin", "keyword": "plumber" }
```

**Response:** Partial audit data (some categories locked until email is captured).

---

### `POST /audit/capture`
Public. Records the visitor's email and returns the full audit result.

**Body:** `{ "email": "...", "auditId": "..." }` (session token used to link to prior scan)

---

## Reports

Subscription-gated.

### `GET /reports`
Returns all generated PDF reports for the client.

---

### `POST /reports/generate`
**Requires:** team admin. Manually triggers report generation for the current month.

---

### `GET /reports/:id/download`
Streams the PDF file. Content-Type: `application/pdf`.

---

### `GET /reports/:id/view`
Returns a signed URL or inline HTML view of the report.

---

### `GET /reports/export/rankings`, `/export/keywords`, `/export/reviews`, `/export/citations`
CSV exports by data type.

---

## Geo-Grid

Subscription-gated.

### `POST /geo-grid`
Triggers a geo-grid ranking scan for a location and keyword.

**Body:** `{ "locationId": "uuid", "keyword": "plumber near me", "gridSize": "7x7" }`

---

### `GET /geo-grid`
Returns all geo-grid reports for the client.

---

### `GET /geo-grid/:id`
Returns a single geo-grid report with the full coordinate grid and per-point rank data.

---

## Integrations

### `GET /integrations`
Returns all OAuth integration connections for the client.

---

### `GET /integrations/google/auth-url`
**Requires:** team admin. Returns the Google OAuth URL for Business Profile connection.

---

### `GET /integrations/google/callback`
Public. OAuth callback for Google Business Profile.

---

### `GET /integrations/facebook/auth-url`
**Requires:** team admin. Returns the Facebook OAuth URL.

---

### `GET /integrations/facebook/callback`
Public. OAuth callback for Facebook.

---

### `DELETE /integrations/:provider`
**Requires:** team admin. Disconnects an integration (`google`, `facebook`).

---

## Reputation

Subscription-gated.

### `POST /reputation/reviews/:reviewId/reply`
Posts a reply to a review via BrightLocal Reputation Manager API.

**Body:** `{ "reply": "Thank you for your feedback!" }`

---

### `POST /reputation/sync`
Triggers a BrightLocal review sync for the client.

---

## Campaigns (Review Requests)

Subscription-gated.

### `GET /campaigns`
Returns all EmbedMyReviews campaigns.

---

### `POST /campaigns`
**Requires:** team admin. Creates a new campaign.

---

### `POST /campaigns/:campaignId/invite`
**Requires:** team admin. Sends a single review request.

**Body:**
```json
{ "firstName": "Jane", "lastName": "Doe", "email": "jane@example.com" }
```

---

### `POST /campaigns/:campaignId/invite/bulk`
**Requires:** team admin. Sends up to 500 review requests from a parsed CSV.

**Body:**
```json
{ "contacts": [{ "firstName": "...", "email": "..." }, ...] }
```

---

### `GET /campaigns/unsubscribes`
Returns all contacts who unsubscribed from review request emails.

---

### `GET /campaigns/credits`
Returns remaining EMR campaign sending credits.

---

### `GET /campaigns/templates`
Returns available EMR campaign templates.

---

## Team

### `GET /team`
Returns all team members for the client.

**Response:**
```json
{
  "success": true,
  "data": {
    "members": [
      { "id": "uuid", "email": "staff@agency.com", "role": "staff", "joinedAt": "..." }
    ]
  }
}
```

---

### `POST /team/invite`
**Requires:** team admin. Sends an invite email to a new staff member.

**Body:** `{ "email": "newstaff@agency.com" }`

---

### `DELETE /team/:memberId`
**Requires:** team admin. Removes a staff member.

---

### `GET /team/accept?token=<invite-token>`
Public. Renders the invite acceptance page.

---

### `POST /team/accept`
Public. Confirms invite acceptance (sets password if new user).

---

## Billing

### `GET /billing/status`
Returns subscription status, current tier, next billing date, and location count.

---

### `POST /billing/checkout`
**Requires:** team admin. Creates a Stripe Checkout session for initial subscription.

**Body:** `{ "tier": 1, "promoCode": "LAUNCH20" }`

**Response:** `{ "checkoutUrl": "https://checkout.stripe.com/..." }`

---

### `POST /billing/subscription-intent`
Returns Stripe publishable key and client secret for an in-app payment form.

---

### `POST /billing/validate-promo`
Validates a promo code before checkout.

**Body:** `{ "code": "LAUNCH20" }`

---

### `POST /billing/portal`
**Requires:** team admin. Creates a Stripe Customer Portal session for managing subscriptions.

**Response:** `{ "portalUrl": "https://billing.stripe.com/..." }`

---

### `POST /billing/webhook`
Public. Receives Stripe webhook events. Requires raw body; validates `Stripe-Signature` header against `STRIPE_WEBHOOK_SECRET`. Handles: `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`, `customer.subscription.updated`.

---

## QR Codes

### `GET /qr`
Returns all QR codes for the client.

---

### `POST /qr`
**Requires:** team admin. Creates a new trackable QR code.

**Body:** `{ "label": "Front Door Sign", "destinationUrl": "https://g.page/r/..." }`

---

### `DELETE /qr/:id`
**Requires:** team admin.

---

### `GET /qr/:id/image.png`
Returns the QR code as a PNG image. Content-Type: `image/png`.

---

### `GET /qr/r/:code`
Public. Redirect endpoint — logs scan (timestamp, user agent) and redirects to destination URL.

---

## Widget

### `GET /widget`
Returns widget configuration for the client.

---

### `PATCH /widget`
**Requires:** team admin. Updates widget display settings.

---

### `POST /widget/regenerate`
**Requires:** team admin. Regenerates the public widget key (invalidates old embed).

---

### `GET /widget/:key`
Public. Called by the embeddable `widget.js` from third-party sites. Returns review data for display. CORS: `Access-Control-Allow-Origin: *`.

---

## Places Autocomplete

### `GET /places/cities?q=aust&lat=30.27&lng=-97.74`
Auth required. Returns city autocomplete suggestions from Google Places API, biased toward provided coordinates.

---

## Health

### `GET /health/live`
Public. Always returns `200` if the process is running. Used as Kubernetes/Docker liveness probe.

**Response:** `{ "status": "ok" }`

---

### `GET /health/ready`
Public. Checks PostgreSQL and Redis connectivity. Returns `503` if either is unavailable.

**Response:** `{ "status": "ok"|"degraded", "db": true, "redis": true }`

---

## Admin (superlocalseo operator only)

All routes require `role = admin`.

### `GET /admin/overview`
Platform-wide stats: total clients, active, trialing, MRR estimate, recent signups.

---

### `GET /admin/clients`
Full client list with subscription status, location count, last active.

---

### `GET /admin/customers`
Alias with extended customer details.

---

### `PATCH /admin/customers/:clientId`
Update a customer's subscription tier or status directly.

---

### `DELETE /admin/customers/:clientId`
Hard-delete a customer account.

---

### `GET /admin/queues`
BullMQ queue status: waiting, active, completed, and failed job counts per queue.

---

### `POST /admin/jobs/trigger`
Manually trigger a background job by name.

**Body:** `{ "job": "poll-pending" | "rankings" | "reviews" | "citations" | "reports" }`

---

### `GET /admin/analytics`
Platform-wide analytics: signups over time, churn, revenue by tier.

---

### `GET /admin/citations`
Overview of all citation campaigns across all clients.

---

### `GET /admin/citations/locations`
All locations eligible for citation campaigns.

---

### `POST /admin/citations/campaign`
Create a citation campaign for any client location.

---

### `GET /admin/citations/campaign/:campaignId`
Get campaign details.

---

### `GET /admin/citations/campaign/:campaignId/lookup`
Preview directory matches for a campaign.

---

### `POST /admin/citations/campaign/:campaignId/confirm`
Submit a citation campaign.

---

### `GET /admin/promos`
List all promo codes.

---

### `POST /admin/promos`
Create a new promo code.

**Body:** `{ "code": "LAUNCH20", "discountPercent": 20, "expiresAt": "2026-12-31" }`

---

### `DELETE /admin/promos/:promoId`
Deactivate a promo code.
