# SuperLocalSEO

Enterprise-grade local SEO platform for service businesses (plumbers, HVAC, electricians). Aggregates ranking data, reviews, and citations into a unified dashboard with automated monthly PDF reports.

**Live at:** [superlocalseo.com](https://superlocalseo.com)

---

## What It Does

- **Rankings** — Daily keyword rank tracking via BrightLocal, stored permanently in our DB (BrightLocal provides no history — we do)
- **Reviews** — Multi-platform review monitoring powered by EmbedMyReviews (white-labeled at `app.superlocalseo.com`), with real-time webhook ingestion for new/updated reviews and private feedback
- **Citations** — Directory listing presence and NAP accuracy monitoring via BrightLocal Data API; guided fix workflow for unlisted/mismatched entries
- **Reports** — Automated monthly PDF reports generated and emailed on the 1st of each month
- **Analytics** — Historical ranking charts (30d/90d/all-time), review volume by platform, sentiment trends, CSV exports
- **Google Business Profile** — OAuth connect for review sync and business info
- **Google Sign-In** — One-click Google OAuth login/registration alongside email+password
- **Review Request Campaigns** — Send email/SMS review invites via EmbedMyReviews campaigns; happy customers directed to Google, dissatisfied ones routed to private feedback

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, SWR, React Router v6, Recharts |
| Backend | Node.js 20, Express, TypeScript |
| Database | PostgreSQL 15 (primary), Redis 7 (cache + sessions) |
| Queue | BullMQ (scheduled data pulls, report generation) |
| PDF | Puppeteer (report rendering) |
| Email | Resend |
| Payments | Stripe (subscriptions, per-location billing at $125/mo per additional location) |
| Auth | JWT (access + refresh tokens) + Google OAuth 2.0 |
| External APIs | BrightLocal Data API (rankings, geo-grid, citation auditing) · EmbedMyReviews (reviews, campaigns, private feedback) |
| DevOps | Docker, Docker Compose, Nginx |

## Local Development

```bash
git clone https://github.com/rutgersguy/superlocalseo.git
cd superlocalseo
cp .env.example .env        # fill in your keys
docker compose up -d        # starts postgres, redis, api, web, nginx
```

API: `http://localhost:3000` · Frontend: `http://localhost:5173`

See [docs/SETUP.md](docs/SETUP.md) for full local dev instructions.

## Project Structure

```
superlocalseo/
├── backend/
│   ├── src/
│   │   ├── controllers/     Route handlers
│   │   ├── services/        Business logic + external API wrappers
│   │   ├── routes/          Express routers
│   │   ├── db/              Knex connection, migrations, seeds
│   │   ├── jobs/            BullMQ queue workers + cron jobs
│   │   ├── middleware/      Auth, rate limiting, validation
│   │   └── utils/           JWT, crypto, logger, response helpers
├── frontend/
│   └── src/
│       ├── pages/           Route-level components
│       ├── components/      Shared UI components (incl. EMRSetupBanner)
│       ├── hooks/           useAuth, SWR hooks
│       ├── services/        API client (apiFetch, fetcher)
│       └── layouts/         DashboardLayout
├── docs/                    Architecture, setup, pricing
├── docker-compose.yml
└── nginx.conf
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — System design, data flow, DB schema
- [Setup](docs/SETUP.md) — Local development guide
- [Pricing Model](docs/PRICING.md) — Location-based billing logic
- [Roadmap](ROADMAP.md) — Phase 0–4 delivery plan with current status

---

## EmbedMyReviews Integration

SuperLocalSEO uses [EmbedMyReviews](https://www.embedmyreviews.com) as the review management backend, white-labeled under `app.superlocalseo.com`. Customers log into that subdomain to connect their Google, Yelp, and other review profiles, and to manage review request campaigns.

### API Endpoints

| Purpose | Base URL |
|---|---|
| Regular API (reviews, campaigns, feedback) | `https://app.superlocalseo.com/api/v1` |
| Agency API (customer lifecycle) | `https://app.superlocalseo.com/api/agency/v1` |

Configured via `EMBEDMYREVIEWS_BASE_URL` (defaults to `https://app.superlocalseo.com`).

### Sub-Account Provisioning

When a customer completes onboarding, `provisionClient()` automatically:

1. Calls `POST /api/agency/v1/customers` to create an EMR sub-account
2. Stores the generated password (encrypted) in `clients.emr_password_encrypted`
3. Stores the customer ID in `clients.emr_customer_id`
4. Creates/updates an `integrations` row pointing to the shared operator API key

Customers can retrieve their EMR login credentials at any time via `GET /clients/emr-credentials`, which surfaces email, password, and login URL. The `EMRSetupBanner` component on the Reviews and Campaigns pages shows this credential modal and prompts customers to finish EMR setup.

### Required ENV Vars

```
EMBEDMYREVIEWS_API_KEY=       # Shared operator key (used for review reads)
EMBEDMYREVIEWS_AGENCY_KEY=    # Agency key (used for customer lifecycle calls)
EMBEDMYREVIEWS_BASE_URL=      # Defaults to https://app.superlocalseo.com
EMBEDMYREVIEWS_WEBHOOK_SECRET= # Optional; for future webhook signature verification
```

### Webhook Integration

Private feedback and review events are delivered in real time via EMR webhooks.

**Receiver endpoint:** `POST /webhooks/emr`

**Supported events:**
- `review-created` / `review-updated` — upserts into `reviews` table
- `private-feedback-created` / `private-feedback-updated` — upserts into `private_feedback` table

**Webhook registration:** Manual, via the EMR agency dashboard UI (`app.superlocalseo.com → Settings → API & Webhooks`). Enter `https://superlocalseo.com/webhooks/emr` as the endpoint URL and select all events at the agency level (no organization filter) so all client events are captured.

Client matching: the webhook payload includes `organization_id`, which maps to `clients.emr_customer_id`.

> **Note:** There is no API endpoint for webhook registration — it must be done through the dashboard UI.

### Customer Onboarding Flow

1. Customer registers (email + password or Google Sign-In)
2. Onboarding wizard: business details → locations (step 1) → billing (step 2) → connect Google Business Profile (step 3) → review management setup (step 4)
3. On `POST /clients/complete-onboarding`: EMR sub-account is provisioned (12-second timeout; failure is non-fatal and retried), citation scan is queued
4. Credentials for `app.superlocalseo.com` are available immediately via `GET /clients/emr-credentials`
5. Customer logs into `app.superlocalseo.com` and connects their review profiles and/or sets up campaigns

### Pricing

- Base plan covers 1 location
- Additional locations: **+$125/mo per location** (enforced via Stripe per-location billing)

---

## Known Issues / Ops Notes

- **Existing test accounts** (`brent@superlocalseo.com`, `airserve@superlocalseo.com`): created before the password-storage fix; `emr_password_encrypted` is NULL. EMR sub-accounts exist (customer IDs 3 and 2 respectively). Credentials were set manually.
- **AirServe GBP OAuth**: Token expired 2026-05-11; refresh returns `unauthorized_client`. Client needs to reconnect Google Business Profile in the app.
- **BullMQ reviews job**: Runs hourly. Pulls reviews via EMR API. Private feedback is received via webhook, not polled.
