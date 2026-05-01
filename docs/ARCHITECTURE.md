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
            │  brightlocal:pull (daily 06:00 UTC)              │
            │  embedmyreviews:pull (every 6h)                  │
            │  reports:generate-monthly (1st of month 08:00)   │
            └──────┬──────────────────────────┬────────────────┘
                   │                          │
       ┌───────────▼────────┐    ┌────────────▼──────────────┐
       │   BrightLocal API  │    │   EmbedMyReviews API      │
       │  rankings+citations │    │  reviews + webhooks       │
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
| brightlocal_campaign_id | text | |
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
Historical record of every BrightLocal pull. **This is our core differentiator** — BrightLocal provides no historical data.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| keyword_id | uuid FK → keywords | |
| location_id | uuid FK → locations | |
| rank | int | null = not ranked |
| url_ranked | text | page URL that ranked |
| search_engine | text | `google` \| `bing` |
| pulled_at | timestamptz | timestamp of pull |

Index: `(keyword_id, location_id, pulled_at DESC)` for trend queries.

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
| `rankings:{clientId}:{locationId}` | 24h | After BrightLocal pull |
| `reviews:{clientId}` | 6h | After pull or webhook |
| `citations:{clientId}:{locationId}` | 24h | After BrightLocal pull |
| `metrics:{clientId}:{date}` | 24h | After metrics_daily rollup |
| `session:{token}` | 7d | On logout |

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
