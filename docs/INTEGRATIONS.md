# SuperLocalSEO — Third-Party Integrations

**Audience:** Developers and operators setting up or maintaining integrations  
**Purpose:** Auth methods, rate limits, fallback strategies, cost model, and key management for every external service

---

## Integration Matrix

| Service | Purpose | Auth Type | Key Location | Status |
|---|---|---|---|---|
| DataForSEO | SERP rankings, Lighthouse audits, on-page checks | HTTP Basic | `.env` (operator) | Active |
| BrightLocal Data API | Citations, geo-grid | `x-api-key` header | `.env` (operator) | Active |
| BrightLocal Management API | Citation submission | `api-key` query param | `.env` (operator) | Planned |
| EmbedMyReviews | Review aggregation, campaigns | API key + HMAC webhook | `.env` (operator) | Active |
| Stripe | Subscriptions, billing | Secret key + webhook HMAC | `.env` (operator) | Active |
| Google OAuth 2.0 | User sign-in + Business Profile connect | OAuth 2.0 PKCE | `.env` (operator) | Active |
| Google Places API | Audit lookup, competitor search | API key | `.env` (operator) | Active |
| Anthropic Claude | AI review response drafting | API key | `.env` (operator) | Active |
| Resend | Transactional email | API key | `.env` (operator) | Active |
| Sentry | Error tracking (FE + BE) | DSN | `.env` + build var | Active |
| Prometheus / prom-client | Metrics export | Admin bearer token | Runtime | Active |

---

## DataForSEO

**Docs:** https://docs.dataforseo.com  
**Auth:** HTTP Basic — `Authorization: Basic base64(login:password)`  
**Env vars:** `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`

### Endpoints Used

| Endpoint | Purpose | When Called |
|---|---|---|
| `POST /serp/google/organic/live/advanced` | Keyword rankings (organic + local pack) | Daily rankings job + manual sync |
| `POST /keywords_data/google_ads/search_volume/live` | Monthly search volume for keywords | Backfill job on keyword add |
| `POST /dataforseo_labs/google/ranked_keywords/live` | Competitor keyword discovery | On-demand via `/competitors/:id/discover-keywords` |
| `POST /on_page/task_post` | On-page SEO audit (crawl) | On SEO audit trigger |
| `POST /on_page/summary` | Retrieve on-page audit results | Poll every 5 min via BullMQ |
| `POST /lighthouse/task_post` | Performance audit submission | After on-page audit completes |
| `POST /lighthouse/get_result` | Retrieve Lighthouse results | Poll every 5 min via BullMQ |

### Rate Limits

DataForSEO is pay-per-request with no hard rate limits, but best practice:
- Avoid bursting more than 10 concurrent requests
- Rankings: 1 request per keyword per location per day (stagger over 30–60 min window)
- Lighthouse tasks take 20–90 seconds; poll every 5 min (not faster)

### Cost Model

| Endpoint | Approx. Cost |
|---|---|
| SERP organic live advanced | ~$0.002/request |
| Search volume live | ~$0.001/keyword |
| Ranked keywords live | ~$0.05/request |
| On-page task | ~$0.01/task |
| Lighthouse task | ~$0.01/task |

Monthly cost estimate (10 clients, 2 locations, 5 keywords): ~$15–30/month

### Fallback Strategy

- On-page audit failure: store error in `location_audits.raw_result`, show "Unable to retrieve audit data" in UI
- Lighthouse task rejected (e.g. domain not found): task ID stored as null, performance section shows "Not available"
- Poll timeout (task still pending after 24h): mark as failed, do not retry automatically

### Key Management

Credentials are at the operator level — single pair for all clients. Set in `.env`:
```
DATAFORSEO_LOGIN=your@email.com
DATAFORSEO_PASSWORD=your_password
```

---

## BrightLocal

BrightLocal exposes two separate APIs with different base URLs, auth methods, and pricing.

### Data API (Active)

**Base URL:** `https://api.brightlocal.com`  
**Auth:** `x-api-key: <key>` header  
**Env var:** `BRIGHTLOCAL_API_KEY`  
**Plan required:** Simply Listings (free tier supports data lookups)

| Endpoint | Purpose | When Called |
|---|---|---|
| `POST /data/v1/listings/find` | Citation lookup per directory | Daily citations job |
| Geo-grid endpoint | 7×7 or 13×13 rank grid by coordinate | On-demand via `/geogrid` |

**Rate limits:** Not explicitly documented; avoid more than 5 concurrent requests. Add 200ms delay between batch calls.

**Cost:** ~$0.005/listing lookup. For 10 clients × 2 locations × 40 directories = ~$4/day

### Management API (Planned)

**Base URL:** `https://tools.brightlocal.com`  
**Auth:** `?api-key=<key>` query param (separate key from Data API)  
**Plan required:** Paid plan (currently on free tier — Management API not active)  
**Planned use:** Automated citation submission to 40–80 directories via citation builder

**Current fallback:** When a client's citation is missing or incorrect, the UI provides directory-specific claim URLs for manual submission. No automated submission yet.

### Env vars

```
BRIGHTLOCAL_API_KEY=            # Data API key
# BRIGHTLOCAL_MGMT_KEY=         # Future: Management API key
```

---

## EmbedMyReviews

**Docs:** https://embedmyreviews.com/docs  
**Auth:** `Authorization: Bearer <api_key>` header for REST; HMAC-SHA256 for webhooks  
**Env vars:** `EMBEDMYREVIEWS_API_KEY`, `EMBEDMYREVIEWS_WEBHOOK_SECRET`

### What It Provides

- Review aggregation from 100+ platforms (Google, Yelp, Facebook, Trustpilot, etc.)
- Campaign management (email + SMS review request funnels)
- Smart review gating: happy customers → public review link; unhappy → private feedback form

### ⚠️ The API is much larger than what we wrap (audited 2026-07-13)

Our `embedmyreviews.service.ts` wraps a small fraction of the documented API
(https://www.embedmyreviews.com/docs/api/ — note `api.embedmyreviews.com` is a misleadingly
thin stub). Findings that change the architecture:

**`POST /api/agency/v1/connect-links` — solves the second-login problem.** Mints a single-use,
location-scoped OAuth link ("no platform login"). We hand the `connect_url` to the client in
*our* branding via *our* email; they sign in with Google directly and never see EMR. Lifecycle
fields (`status`, `completed_oauth_at`, `expires_at`) let us poll for completion; companion
endpoints list/revoke. `send_google_connect_link` can also be set at customer creation.
**Blocker:** it requires an EMR `location_id`, and the docs reference `/api/v1/locations` but
never document it. Open question with their support.

**EMR CANNOT publish a review reply to Google via API.** `PUT /api/v1/reviews/{id}` has no
`reply` field and 403s on synced (Google/Facebook) reviews. The only reply-write surface is an
MCP tool, `draft_review_response`, whose drafts are "always held for agency approval and never
auto-sent" — a human must approve in the EMR UI. Live posting requires an Auto-Respond rule with
approval disabled, which is UI-only configuration we cannot script.

**Google replies require Grant Access, not Public Access.** Public Access (Place ID, no auth)
explicitly does not support direct replies.

**Likely (INFERRED, not confirmed): EMR holds its own approved GBP project.** They serve
`GET /api/v1/gbp/metrics` and `/gbp/search-terms` (impressions, call clicks, direction requests)
— surfaces that require Google-approved GBP access and are not obtainable from the Places API.
If true, routing through EMR **sidesteps our pending quota entirely**. No EMR doc states this.
**Confirm before architecting around it** — see Open vendor questions.

### Known bug in our wrapper

`suspendCustomer()` calls `POST /customers/{id}/suspend`; the documented endpoint is
**`PUT /api/agency/v1/customers/{customer}/pause`** (counterpart: `/resume`). The function
swallows failures as a non-fatal warning, so this fails **silently** on every cancellation.
Not yet fixed.

### Endpoints Used

| Operation | Endpoint | When |
|---|---|---|
| Fetch reviews | `GET /api/reviews` | Every 6h via BullMQ job |
| Fetch campaigns | `GET /api/campaigns` | On dashboard load |
| Send single invite | `POST /api/campaigns/:id/invite` | User-initiated |
| Send bulk invites | `POST /api/campaigns/:id/invite/bulk` | User-initiated (up to 500/batch) |
| Fetch campaign funnel | `GET /api/campaigns/:id/funnel` | On Campaigns page load |

### Webhook Events

The webhook handler at `POST /api/reviews/webhook` processes:
- `review.created` — new review ingested
- `review.updated` — review modified (rating changed, reply added, hidden toggled)

**Validation:** EMR publishes no webhook signing secret or signature header (their
webhook docs are unfinished and the dashboard only accepts a destination URL). So the
webhook is authenticated by a **shared token we control** (`EMBEDMYREVIEWS_WEBHOOK_TOKEN`),
sent as a `?token=` query param on the registered URL or an `X-Webhook-Token` header, and
compared in constant time (`verifyEmrWebhook`). When neither the token nor the legacy
`EMBEDMYREVIEWS_WEBHOOK_SECRET` (HMAC-SHA256, kept only in case EMR ever documents real
signing) is set, the endpoint logs a loud error and passes through — so it never drops
live ingestion, but stays UNAUTHENTICATED until the token is set.

> Note: a query-param token appears in nginx access logs. It's a rotatable bearer secret
> over HTTPS — rotate by changing `EMBEDMYREVIEWS_WEBHOOK_TOKEN` and the EMR URL together.

### Registration

1. Generate a token: `openssl rand -hex 32`.
2. Set `EMBEDMYREVIEWS_WEBHOOK_TOKEN=<value>` in `.env` and restart the API.
3. In the EMR dashboard, add the webhook URL **with the token appended**:
   `https://superlocalseo.com/api/reviews/webhook?token=<value>`
4. Enable the review events (EMR names them e.g. `ReviewCreated`).

### Rate Limits

No documented hard limit. Bulk invite endpoint: max 500 contacts per batch; add 1-second delay between batches if sending multiple.

---

## Stripe

**Auth:** Secret key in `Authorization: Bearer` header (handled by Stripe SDK)  
**Env vars:** `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, price IDs

### Subscription Model

The billing structure uses Stripe's flat-rate + metered billing:
- `STRIPE_SETUP_PRICE_ID` — one-time setup fee
- `STRIPE_BASE_PRICE_ID` — base monthly subscription
- `STRIPE_LOCATION_PRICE_ID` — per-extra-location add-on

### Webhook Events

Handled at `POST /webhooks/stripe`:

| Event | Action |
|---|---|
| `invoice.paid` | Set `subscription_status = 'active'`, update tier |
| `invoice.payment_failed` | Set `subscription_status = 'past_due'` |
| `customer.subscription.deleted` | Set `subscription_status = 'canceled'` |

**Validation:** `stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)` — raw body required (not parsed JSON).

### Stripe Dashboard Setup

1. Create Products and Prices matching your tier structure.
2. Add webhook endpoint: `https://superlocalseo.com/webhooks/stripe`
3. Subscribe to: `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`
4. Copy webhook signing secret to `STRIPE_WEBHOOK_SECRET`
5. Use **live** keys in production (`sk_live_...`, `pk_live_...`)

### Env vars

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_SETUP_PRICE_ID=
STRIPE_BASE_PRICE_ID=
STRIPE_LOCATION_PRICE_ID=
```

---

## Google OAuth 2.0

Two separate OAuth flows with different scopes and callback URIs.

### User Sign-In

**Scopes:** `openid email profile`  
**Callback:** `GET /api/auth/google/callback`

On success: creates or updates `users` record, sets `google_id`, issues JWT + refresh cookie.

### Google Business Profile Connect

**Scopes:** `https://www.googleapis.com/auth/business.manage`  
**Callback:** `GET /api/integrations/google/callback`

On success: stores OAuth access token + refresh token in `integrations` table (encrypted at rest).

> **⚠️ CURRENTLY INERT — GBP API quota approval is PENDING (as of 2026-07-13).**
>
> Our Google Cloud project (`724720371422`) has `quota_limit_value: 0` on
> `mybusinessaccountmanagement.googleapis.com`. Clients can complete the OAuth flow and the
> integration shows as connected, but **`syncGBPReviews` returns nothing for every client** —
> including freshly-connected, healthy ones. This is a Google-side approval blocker, not a
> code bug. Until it clears, GBP review sync delivers zero value.
>
> **What we hold the `business.manage` scope for but never use:** we only ever READ. Nothing
> in the codebase posts a review reply back to Google (`reviewReply` is never called). The AI
> draft flow in `Reviews.tsx` tells the user to copy/paste the text themselves. The only code
> that actually publishes a reply is the BrightLocal path in `reputation.controller.ts`.
>
> **Q&A and business-info sync are NOT available through this integration** — see below.

### ❌ GBP Q&A — DEAD, DO NOT BUILD

Google **discontinued the My Business Q&A API on 2025-11-03**:

> "On November 3, 2025, we will be discontinuing the My Business Q&A API… You can no longer
> read or post questions and answers using the API."
> — https://developers.google.com/my-business/content/qanda/change-log

Google is also removing the public Q&A section from Business Profiles, replacing it with AI
answers. **No vendor can do this** — not BrightLocal, not EmbedMyReviews, not Yext. It is not a
"later" item; it does not exist. Product copy advertising Q&A sync was removed in PR #123.

### GBP business-info sync — only via BrightLocal Active Sync

Writing business info (categories, hours, description, attributes, NAP) to GBP is **not built**
and cannot be built directly while our quota is pending. The viable path is **BrightLocal Active
Sync / the Listings Management API**, which executes writes against **BrightLocal's own approved
Google project** — so our `quota_limit_value: 0` never enters the picture. It does *not* remove
the client OAuth step; the client consents to BrightLocal instead of to us.

See `API_GAPS.md` BL-7 and **Open vendor questions** below.

### Console Setup

1. Google Cloud Console → Create Project → Enable: **Google+ API**, **Google Business Profile API**
2. OAuth 2.0 → Authorized redirect URIs:
   - `https://superlocalseo.com/api/auth/google/callback`
   - `https://superlocalseo.com/api/integrations/google/callback`
3. Authorized JavaScript origins: `https://superlocalseo.com`
4. Publish OAuth consent screen (required for any non-test users)

### Env vars

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

---

## Google Places API

Used for:
- Audit lead magnet: business lookup by name + city
- Competitor search: `GET /competitors/search`

**Auth:** `key=<api_key>` query parameter  
**Env var:** `GOOGLE_PLACES_API_KEY`

**API restriction:** Restrict the key in Google Cloud Console to the **Places API** only. Set HTTP referrer restriction to `superlocalseo.com/*` for additional security.

**Rate limits:** Default quota: 1,000 requests/day free, then pay-per-request (~$0.017/request). For higher volume, enable billing in Google Cloud.

---

## Anthropic Claude

Used for AI-powered review response drafting.

**Model:** `claude-haiku-4-5-20251001` (fast, cost-efficient)  
**Auth:** `x-api-key: <key>` header  
**Env var:** `ANTHROPIC_API_KEY`

**Rate limiting (internal):** 20 draft requests per 10 minutes per user (Redis-backed sliding window).

**Cost:** ~$0.00025 per input token, ~$0.00125 per output token. Average review response: ~$0.001.

**Fallback:** If Anthropic API returns 5xx or rate limit error, the UI shows an error toast. No automatic retry — user clicks the button again.

**System prompt guidance:**
- Tone-adaptive by star rating (1–3★ = empathetic; 4–5★ = appreciative)
- Under 150 words, no hashtags, no emojis
- References reviewer's name and specific review details

---

## Resend

Used for all transactional email.

**Auth:** `Authorization: Bearer <api_key>`  
**Env vars:** `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`

### Emails Sent

| Trigger | Template | From |
|---|---|---|
| Registration | Email verification link | `hello@superlocalseo.com` |
| Password reset | Reset link (1-hour expiry) | `hello@superlocalseo.com` |
| Team invite | Invite link (48-hour expiry) | `hello@superlocalseo.com` |
| Monthly report | PDF attachment + summary | `hello@superlocalseo.com` |
| BullMQ job failure | Alert to operator inbox | `hello@superlocalseo.com` |

### Domain Setup

1. Add `superlocalseo.com` as a sending domain in Resend.
2. Add Resend SPF record: `TXT @ v=spf1 include:_spf.resend.com ~all`
3. Add DKIM record (Resend provides the value).
4. Verify domain in Resend dashboard before first send.

**Note:** `hello@superlocalseo.com` must be verified as a sending address separately from the domain.

---

## Sentry

**Env vars:**
- Backend: `SENTRY_DSN`
- Frontend: `VITE_SENTRY_DSN` (build-time, injected into React bundle)

### What Gets Tracked

- **Backend:** Unhandled exceptions, BullMQ job failures, explicit `Sentry.captureException()` calls
- **Frontend:** Unhandled JS errors, React error boundaries, API error responses

### Setup

1. Create two Sentry projects: one for Node.js, one for React.
2. Backend DSN → `SENTRY_DSN` in `.env.prod`
3. Frontend DSN → `VITE_SENTRY_DSN` in `frontend/.env.production`
4. Set up Sentry alerts: email on first occurrence of new error type; Slack on volume spike.

---

## Vendor answers (both replied 2026-07-14) — ANSWERED

### EmbedMyReviews — all three blockers cleared

| Question | Answer |
|---|---|
| Create/list locations via API? | ✅ **Yes** — `GET`/`POST /api/v1/locations`. Unblocks `connect-links` (needs a `location_id`). |
| Publish a reply to Google via API? | ✅ **Yes** — `POST /api/v1/reviews/{id}/reply`. *"The reply goes live on the platform IMMEDIATELY — there is no approval step."* |
| Do you hold approved GBP API access? | ✅ **Yes** — *"we are approved for GBP access, you are not required to set anything up on your side. EMR branding is not visible to your customers."* |

**This corrects an earlier WRONG finding in this repo.** A prior audit concluded "EMR cannot
publish a reply via API; drafts are always held for UI approval." That was false — the REST
reply endpoint exists. Do not re-derive the old conclusion.

Consequences, now implemented (PRs #133, #134):
- Our own Google OAuth is **no longer needed for reviews**. EMR's Google approval does the work;
  our pending quota is irrelevant. The route stays mounted but nothing points at it.
- Clients connect Google via a **branded connect-link** on `app.superlocalseo.com` — no EMR
  branding, no second login.
- Reviews are read **per EMR location** (the tenancy boundary — see migration 20260714000000).

**Reply endpoint caveats (from their docs, not yet exercised):** requires the **auto-respond
feature on the organisation's plan** (else **402**); only reviews synced via a Google/Facebook
**API connection** can be replied to (not Place-ID/"public access" sources); replying again to a
Google review **updates** the existing reply, but a second Facebook reply **409s**. Token needs
`reviews:read + reviews:update`.

### BrightLocal — answered

| Question | Answer |
|---|---|
| GBP OAuth initiated via API? | ✅ **Yes** — they have documentation for the API-initiated set-up. **White-label UX is preserved.** |
| Plan tier for Listings Management? | **Manage** or **Grow**. (Custom enterprise plan at 250+ locations.) |
| Per-request API fees? | ❌ **None.** It's a management API — no per-request cost, just the subscription. Rate limit **300/min**. |
| Active Sync writes via BrightLocal's own approved Google project? | ✅ **Confirmed.** Our pending Google quota is irrelevant to it. |
| Photos? | ❌ **Text-only.** Name, address, phone, hours, categories, description, attributes. **Never promise photo sync.** |
| Reputation Manager — post replies to Google via API? | ❌ **"We don't support Review Response via API."** |

**Pricing (from BrightLocal, 2026-07-14). Annual is 25% cheaper than monthly.**

| Locations | Manage /mo | Manage /yr | Grow /mo | Grow /yr |
|---|---|---|---|---|
| 10 | $109 | $980 | $131 | $1,178 |
| 50 | $384 | $3,455 | $494 | $4,445 |
| 100 | $769 | $6,920 | $989 | $8,900 |

Effective per-location on **Manage**: ~$10.90 (10 locs), ~$7.68 (50), ~$7.69 (100). Against Pro
at $349/mo/client (+$125/mo per extra location), the margin is not a concern.

**Take Manage, not Grow.** Grow's premium is review monitoring/response — and BrightLocal
**cannot post review replies via API at all**. EMR does reviews and replies. Paying for Grow buys
nothing we can use.

**Throttling is pointless** (as suspected): no per-request fee and a 300/min limit, while Active
Sync is billed per *location subscription*. Sync as often as is useful; cost is per location, not
per call.

### ⚠️ Our BrightLocal review-reply code is built on an unsupported API

`brightlocal.service.replyToReview()` POSTs to `/v4/rf/reply`, and it is wired into
`POST /api/reputation/reviews/:reviewId/reply` (exposed in `Reviews.tsx` when a review has a
`blReviewId`). BrightLocal states plainly they **do not support review response via API**. This
path can never work. It has never fired in production only because no client has a BrightLocal
reputation campaign. **EMR's reply endpoint is the only way to publish a reply to Google** —
that's phase 3. Remove or replace the BL path; do not build on it.

### Status after both replies

| Capability | Status |
|---|---|
| GBP Q&A | ❌ **Dead at Google.** API discontinued 2025-11-03. No vendor can do it. Do not build. |
| Review sync from Google | ✅ **EMR** (their approved GBP access). Our quota is irrelevant. |
| Reply publishing to Google | ✅ **EMR only** (`POST /reviews/{id}/reply`). ❌ NOT BrightLocal. Plan gating (402) unverified. |
| Client connects Google, white-labelled | ✅ **EMR connect-links** (live). BrightLocal also supports API-initiated OAuth. |
| GBP business-info write (hours, categories, NAP) | ✅ **BrightLocal Active Sync only** — needs a paid **Manage** plan (we're on a free account: new spend). |
| GBP photo sync | ❌ Not supported by Active Sync (text-only). |
| Our own Google GBP API | ⛔ Still quota-blocked — and now **only** needed if we ever want to talk to Google directly. |

---

## Secrets Management

### Storage approach

| Secret Type | Storage |
|---|---|
| Operator API keys (BrightLocal, DataForSEO, EMR, Stripe, etc.) | `.env` file on VPS (never in DB, never in git) |
| Client OAuth tokens (Google Business Profile) | `integrations` table, AES-256 encrypted with `ENCRYPTION_KEY` |
| JWT secrets | `.env` only |
| Webhook secrets | `.env` only |

### Key rotation

| Secret | Rotation Impact | Procedure |
|---|---|---|
| `JWT_SECRET` | All access tokens invalidated (15min re-login) | Update `.env`, restart API |
| `JWT_REFRESH_SECRET` | All refresh tokens invalidated (users must re-login) | Update `.env`, flush Redis session keys, restart |
| `ENCRYPTION_KEY` | **All encrypted DB records become unreadable** | Do NOT rotate without re-encrypting all records first |
| Stripe webhook secret | Webhooks fail until updated | Update in Stripe dashboard, update `.env` |
| `EMBEDMYREVIEWS_WEBHOOK_SECRET` | Webhooks rejected | Update in EMR dashboard, update `.env` |

### `.env` file security

```bash
# Set file permissions — only root can read
chmod 600 /opt/superlocalseo/.env.prod
chown root:root /opt/superlocalseo/.env.prod

# Verify .env is gitignored
grep "\.env" /opt/superlocalseo/.gitignore
```

Never pass secrets via environment variables in `docker-compose.yml` directly — always use `env_file`.
