# Architecture

## System Overview

```
                    ┌─────────────────────────────────────────┐
                    │            superlocalseo.com              │
                    │           (Nginx reverse proxy)           │
                    └───────────────┬────────────┬─────────────┘
                                    │            │
                         ┌──────────▼───┐  ┌─────▼──────────┐
                         │   React SPA  │  │  Express API   │
                         │  (Vite/SWR)  │  │  :3000         │
                         └──────────────┘  └──────┬─────────┘
                                                   │
                    ┌──────────────────────────────┴───────────┐
                    │                                          │
            ┌───────▼──────┐                        ┌─────────▼───────┐
            │  PostgreSQL  │                        │     Redis       │
            │  (primary DB)│                        │  (cache+sessions│
            └──────────────┘                        └─────────────────┘
                    │
            ┌───────▼──────────────────────────────────────────┐
            │               Bull Job Queue                      │
            │  brightlocal:rankings (daily 06:00)              │
            │  brightlocal:citations (monthly)                 │
            │  brightlocal:geogrid (on-demand)                 │
            │  embedmyreviews:pull (every 6h)                  │
            │  reports:generate-monthly (1st of month 08:00)   │
            └──────┬──────────────────────────┬────────────────┘
                   │                          │
       ┌───────────▼────────┐    ┌────────────▼──────────────┐
       │  BrightLocal Data  │    │   EmbedMyReviews API      │
       │  API / rankings,   │    │  reviews + webhooks       │
       │  geo-grid, citation│    │                           │
       │  auditing          │    │                           │
       └────────────────────┘    └───────────────────────────┘

       ┌──────────────────────────────────────────────────────┐
       │   Google OAuth 2.0                                   │
       │  /auth/google          — Sign in with Google        │
       │  /integrations/google  — Business Profile connect   │
       └──────────────────────────────────────────────────────┘
```

## Database Schema (PostgreSQL 15)

### `users`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| email | text unique | |
| password_hash | text nullable | bcrypt; null for Google-only accounts |
| google_id | text unique nullable | set on Google OAuth sign-in |
| role | text | `admin` \| `client` |
| stripe_customer_id | text | |
| email_verified | boolean | always true for Google OAuth users |
| created_at | timestamptz | |

### `clients`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | |
| business_name | text | |
| industry | text | |
| stripe_subscription_id | text | |
| subscription_tier | int | 1, 2, or 3 |
| subscription_status | text | `active` \| `past_due` \| `canceled` |
| created_at | timestamptz | |

### `locations`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_id | uuid FK → clients | |
| name | text | e.g. "Main Office" |
| address | text | |
| city | text | |
| state | text | |
| zip | text | |
| phone | text | NAP |
| website | text | |
| brightlocal_campaign_id | text nullable | nullable — no longer required for any current feature; retained for future Management API citation submission |
| is_primary | boolean | |
| created_at | timestamptz | |

### `integrations`
Client-facing OAuth connections (Google Business Profile; Yelp/Facebook coming soon).
Operator credentials (BrightLocal, EmbedMyReviews) live in `.env` only — not in this table.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_id | uuid FK → clients | |
| provider | text | `google` \| `yelp` \| `facebook` |
| oauth_access_token | text nullable | |
| oauth_refresh_token | text nullable | |
| oauth_expires_at | timestamptz nullable | |
| status | text | `connected` \| `error` \| `disconnected` |
| last_pull_at | timestamptz | |
| error_message | text | |
| created_at | timestamptz | |

Unique constraint: `(client_id, provider)`

### `keywords`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| location_id | uuid FK → locations | |
| keyword | text | |
| created_at | timestamptz | |

### `ranking_snapshots`
Historical record of every DataForSEO SERP pull. **This is our core differentiator** — DataForSEO provides no historical data of its own.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| keyword_id | uuid FK → keywords | |
| location_id | uuid FK → locations | |
| rank | int | null = not ranked |
| url_ranked | text | page URL that ranked |
| search_engine | text | `google` |
| rank_type | text | `organic` \| `local_pack` \| `paid` |
| geo_location | text nullable | null = primary city; `"City, ST"` = service-area city |
| pulled_at | timestamptz | timestamp of pull |

Index: `(keyword_id, location_id, pulled_at DESC)` for trend queries.

### `competitors`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_id | uuid FK → clients | |
| name | text | |
| website | text | Required for SERP domain matching |
| google_place_id | text | |
| google_rating | numeric | |
| google_review_count | int | |
| last_synced_at | timestamptz | |

### `competitor_rankings`
Populated at zero extra cost — the same SERP call used for client rankings scans the top 30 results for any tracked competitor domain.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| competitor_id | uuid FK → competitors | |
| keyword_id | uuid FK → keywords | |
| location_id | uuid FK → locations | |
| rank | int | null = not in top 30 |
| url | text | |
| search_engine | text | `google` |
| geo_location | text nullable | null = primary city; `"City, ST"` = service-area city |
| pulled_at | timestamptz | |

Migration: `20260511040000_competitor_rankings_geo`

### `citation_snapshots`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| location_id | uuid FK → locations | |
| directory | text | e.g. `yelp`, `yellowpages` |
| listed | boolean | |
| nap_match | boolean | Name/Address/Phone match |
| listing_url | text | |
| pulled_at | timestamptz | |

### `reviews`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_id | uuid FK → clients | |
| location_id | uuid FK → locations | |
| platform | text | `google` \| `yelp` \| `trustpilot` etc. |
| external_review_id | text | platform's review ID |
| author_name | text | |
| rating | int | 1–5 |
| body | text | |
| sentiment | text | `positive` \| `neutral` \| `negative` |
| status | text | `new` \| `responded` \| `archived` |
| review_date | timestamptz | original review date |
| ingested_at | timestamptz | when we stored it |
| platform_url | text | link back to source |

Unique constraint: `(platform, external_review_id)` — dedup on ingest.

### `reports`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_id | uuid FK → clients | |
| period_month | int | 1–12 |
| period_year | int | |
| status | text | `pending` \| `generated` \| `sent` \| `failed` |
| file_path | text | local path or S3 key |
| generated_at | timestamptz | |
| sent_at | timestamptz | |
| email_recipient | text | |

### `metrics_daily`
Pre-aggregated daily rollups for fast dashboard queries.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_id | uuid FK → clients | |
| location_id | uuid FK → locations | |
| date | date | |
| avg_ranking | numeric | average across all keywords |
| top_10_count | int | keywords ranking 1–10 |
| review_count | int | reviews received that day |
| avg_rating | numeric | |
| citation_completeness | numeric | 0–100 |

### `audit_logs`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | |
| action | text | e.g. `client.created`, `integration.connected` |
| resource_type | text | |
| resource_id | uuid | |
| metadata | jsonb | |
| created_at | timestamptz | |

---

## External API Architecture

### DataForSEO — active, pay-per-request

Auth: HTTP Basic (`DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD`)

| Endpoint | Use |
|---|---|
| `POST /serp/google/organic/live/advanced` | Keyword rankings (primary city + service-area cities). Returns top 30 results; client and all tracked competitors matched in one call. |
| `POST /keywords_data/google_ads/search_volume/live` | Monthly search volume backfill for keywords with null volume. |
| `POST /dataforseo_labs/google/ranked_keywords/live` | Competitor keyword discovery — up to 1000 keywords sorted by search volume. Location code must be country-level (`2840` for USA). |

Cost: ~$0.001–$0.005/request depending on endpoint.

### BrightLocal (two separate APIs)

**Data API** — `api.brightlocal.com` — active, pay-per-request
- Auth: `x-api-key` header (platform key, not per-client)
- Listings: `POST /data/v1/listings/find` — find business by NAP per directory; returns listed status, NAP data, is_claimed, reviews, photos — used for citation auditing
- Geo-grid: coordinate-based ranking requests (7×7 or 13×13 grid) stored in `geo_grid_reports`
- Cost: ~$0.005/request
- **Note:** Rankings formerly used this API; now handled by DataForSEO SERP API

**Management API** — `tools.brightlocal.com` — planned, not active
- Auth: `api-key` query param (separate key from Data API)
- Planned use: citation submission to 40-80+ directories via citation builder endpoints
- Requires paid BrightLocal plan — currently on free Simply Listings plan
- Active fallback: guided manual workflow with directory-specific claim URLs

---

## API Routes Summary

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Email + password registration |
| POST | `/auth/login` | — | Returns access token + refresh cookie |
| POST | `/auth/refresh` | cookie | Silent token rotation |
| GET | `/auth/google` | — | Redirect to Google OAuth |
| GET | `/auth/google/callback` | — | OAuth callback → sets cookie, redirects |
| GET | `/clients` | jwt | Get client profile + integrations |
| PATCH | `/clients` | jwt | Update business name, industry |
| GET | `/rankings` | jwt | Latest snapshot per keyword+location |
| GET | `/rankings/trend` | jwt | Rank over time (days param) |
| GET | `/reviews` | jwt | Paginated reviews with filters |
| POST | `/reviews/webhook` | hmac | Real-time review ingest |
| GET | `/citations` | jwt | Latest citation snapshots |
| GET | `/analytics/rankings/history` | jwt | Arbitrary date range snapshots |
| GET | `/analytics/reviews/trend` | jwt | Volume + sentiment series |
| GET | `/analytics/export` | jwt | CSV download (rankings or reviews) |
| GET | `/integrations/google/auth-url` | jwt | Google Business Profile OAuth URL |
| GET | `/integrations/google/callback` | — | Business Profile OAuth callback |
| DELETE | `/integrations/:provider` | jwt | Disconnect a platform |
| GET | `/competitors` | jwt | List competitors + client rating stats |
| POST | `/competitors` | jwt+admin | Add competitor |
| GET | `/competitors/search` | jwt | Location-biased Google Places search |
| GET | `/competitors/gap` | jwt | Keyword Battleground (per-keyword × city competitive status) |
| GET | `/competitors/head-to-head` | jwt | Per-keyword rank comparison vs one competitor |
| GET | `/competitors/scan-status` | jwt | Cooldown gate state + active scan flag |
| POST | `/competitors/sync-rankings` | jwt+admin | Queue immediate rankings scan |
| GET | `/competitors/:id/discover-keywords` | jwt | DataForSEO Labs: keywords competitor ranks for |
| POST | `/competitors/:id/sync` | jwt+admin | Refresh competitor Google rating |
| DELETE | `/competitors/:id` | jwt+admin | Remove competitor |
| GET | `/metrics` | jwt | Dashboard summary cards |
| GET | `/reports` | jwt | List reports |
| GET | `/reports/:id/download` | jwt | Download PDF |
| POST | `/reports/generate` | jwt | Manual report trigger |
| POST | `/billing/portal` | jwt | Stripe Customer Portal session |

---

## Data Flow

### Rankings Pull (Daily, 06:00 UTC)
```
Bull cron job
  → GET /api/brightlocal/rankings (per location, per keyword)
  → INSERT INTO ranking_snapshots
  → UPDATE metrics_daily rollup
  → Invalidate Redis cache: rankings:{clientId}:{locationId}
```

### Reviews Pull (Every 6 hours)
```
Bull cron job
  → GET /api/embedmyreviews/reviews (per client)
  → INSERT INTO reviews (ON CONFLICT DO NOTHING — dedup by external_review_id)
  → Update sentiment field
  → Invalidate Redis cache: reviews:{clientId}
```

### Review Webhook (Real-time)
```
EmbedMyReviews → POST /reviews/webhook
  → Validate HMAC signature
  → INSERT INTO reviews (or UPDATE if exists)
  → Invalidate Redis cache
```

### Monthly Report Generation (1st of month, 08:00 UTC)
```
Bull cron job
  → Query: rankings delta (this month vs last month)
  → Query: reviews summary (count, avg rating, sentiment breakdown)
  → Query: citation completeness
  → Render HTML report template (Handlebars/EJS)
  → Puppeteer: HTML → PDF
  → Store PDF (local /data/reports/ or S3)
  → INSERT INTO reports
  → SendGrid: HTML email + PDF attachment
  → UPDATE reports SET status = 'sent'
```

---

## Caching Strategy (Redis)

| Key Pattern | TTL | Invalidated By |
|---|---|---|
| `rankings:{clientId}:{locationId}` | 24h | After DataForSEO rankings pull |
| `reviews:{clientId}` | 6h | After pull or webhook |
| `citations:{clientId}:{locationId}` | 24h | After BrightLocal pull |
| `metrics:{clientId}:{date}` | 24h | After metrics_daily rollup |
| `session:{token}` | 7d | On logout |
| `rankings:cooldown:{clientId}` | 86 400s | Set after manual scan; expiry opens the gate |

---

## Security

- All API keys (BrightLocal, EMR) stored AES-256 encrypted in DB
- JWT access tokens: 15-minute expiry
- Refresh tokens: 7-day expiry, stored in Redis, one-time use (rotation)
- Webhook signatures validated via HMAC (EmbedMyReviews secret)
- Stripe webhooks validated via `stripe.webhooks.constructEvent`
- Rate limiting: 100 req/15min per IP (auth endpoints: 10 req/15min)
- SQL injection prevention: Knex parameterized queries only
- CORS: origin whitelist (superlocalseo.com only in production)

---

## RBAC Matrix

The platform has two layers of access control:

### System Roles (`users.role`)

| Role | Who | Access |
|---|---|---|
| `admin` | Platform operator (us) | All admin routes (`requireAdmin`), cross-client data, `/api/admin/*`, Prometheus metrics |
| `client` | Account owner who signed up | Their own client data only; team management; billing |

### Team Member Roles (`team_members.role`)

Team members are invited by a `client` account owner. They share the owner's `client_id` and access the same data.

| Role | Invite/Remove Staff | Send Review Invites | Add Competitors | Manage QR + Widget | View All Data |
|---|---|---|---|---|---|
| `client` (owner) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `staff` | ❌ | ✅ | ✅ | ✅ | ✅ |

`staff` has identical permissions to `client` (owner) **except** they cannot invite or remove staff members (`requireTeamAdmin` middleware blocks those specific routes).

### Subscription Gating

`requireActiveSubscription` middleware is applied to all data routes. Requests return `402 Payment Required` when `subscription_status` is `canceled` or `past_due` beyond the grace period.

---

## Redis Usage

Redis serves three distinct purposes:

| Use Case | Key Pattern | TTL | Notes |
|---|---|---|---|
| JWT refresh token store | `session:{userId}:{tokenHash}` | 7d | One-time use; deleted on rotation |
| BullMQ job queues | `bull:{queueName}:*` | Managed by BullMQ | Cron schedule + retry metadata |
| Rankings pull cooldown | `rankings:cooldown:{clientId}` | 86400s | Gate for manual sync requests |
| API response cache | `rankings:{clientId}:{locationId}` | 24h | Invalidated after DataForSEO pull |
| API response cache | `reviews:{clientId}` | 6h | Invalidated after EMR pull or webhook |
| AI rate limit | `ratelimit:ai:{userId}` | 600s | Sliding window: 20 drafts/10min |

**Memory management:** Configure Redis with `maxmemory 256mb` and `maxmemory-policy allkeys-lru` in production to prevent OOM. Cache keys are non-critical (will be regenerated on miss); session keys are critical and should not be evicted — ensure 256 MB is sufficient for active session count.

---

## Database Connection Pooling

Knex.js manages the PostgreSQL connection pool. Defaults:

```
min: 2 connections
max: 10 connections
```

**Production recommendation:** Set `max: 20` once you have >5 active clients with concurrent dashboard usage. PostgreSQL default `max_connections` is 100; with pool max=20 and a potential second API instance, set `max_connections=50` in `postgresql.conf` and keep 50 headroom for admin connections.

Check current pool usage:
```sql
SELECT count(*), state FROM pg_stat_activity GROUP BY state;
```

---

## Error Handling & Resilience

### BrightLocal 429 (Rate Limit)

`brightlocal.service.ts` wraps all requests with retry logic:
- On 429: exponential backoff starting at 5 seconds, max 3 retries
- After 3 failures: job marked failed, BullMQ default retry schedule takes over (3 retries, 30s delay)
- Operator receives email alert on job failure via BullMQ failure hook

### DataForSEO Task Polling

Lighthouse and on-page audit tasks are asynchronous:
- Tasks submitted synchronously; results fetched by the `poll-pending` BullMQ job every 5 minutes
- If a task is still pending after 24h: marked as failed, `dfs_on_page_task_id` cleared
- Client UI shows "Fetching performance data…" badge while pending, then hydrates automatically via SWR polling

### PDF Generation Failure

`generateAuditPdf()` failure (Puppeteer crash, OOM, timeout):
- Error propagated to `reportDownload` controller
- Returns `500` with `{ error: "Failed to generate report" }` — no partial PDF written to disk
- Chromium runs with `--no-sandbox --disable-setuid-sandbox` (required in Docker environments)

### Database Pool Exhaustion

When all 10 (or configured max) connections are in use:
- Knex queue request; waits up to `acquireTimeout` (default: 60s)
- After timeout: throws `KnexTimeoutError`
- Express error handler returns `503 Service Unavailable`
- Sentry captures the error with full stack trace
- Alert: if Prometheus shows pool wait time P95 > 5s, increase `max` pool size

### Redis Unavailability

- BullMQ workers: fail to start — API boots in degraded mode (data serving works, background jobs stop)
- Rate limiting: falls back to in-memory store (single-instance only; loses state on restart)
- Session store: refresh token rotation fails → users must re-login

---

## Alert Thresholds

Configure these in your monitoring stack (Prometheus + Alertmanager, Sentry, or UptimeRobot):

| Metric | Warning | Critical | Action |
|---|---|---|---|
| API error rate (`5xx`) | > 1% over 5min | > 5% over 2min | Page on-call; check Sentry |
| API P95 latency | > 1s | > 3s | Check DB pool, slow query log |
| Database connections | > 70% of max | > 90% of max | Increase pool size or add read replica |
| Disk usage (reports volume) | > 70% | > 85% | Clean old reports or expand volume |
| Redis memory | > 70% of maxmemory | > 90% | Increase `maxmemory` or flush stale cache |
| BullMQ failed jobs | > 0 in 1h | > 5 in 1h | Check job logs; external API may be down |
| Health check `/api/health/ready` | 1 failure | 2 consecutive failures | Restart API container; check DB/Redis |
