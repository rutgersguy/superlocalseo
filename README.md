# SuperLocalSEO

Enterprise-grade local SEO platform for service businesses (plumbers, HVAC, electricians). Aggregates ranking data, reviews, and citations into a unified dashboard with automated monthly PDF reports.

**Live at:** [superlocalseo.com](https://superlocalseo.com)

---

## What It Does

- **Rankings** — Daily keyword rank tracking via BrightLocal, stored permanently in our DB (BrightLocal provides no history — we do)
- **Reviews** — Multi-platform review aggregation refreshed every 6 hours, with real-time webhook support
- **Citations** — Directory listing completeness and NAP accuracy monitoring across 50+ directories
- **Reports** — Automated monthly PDF reports generated and emailed on the 1st of each month
- **Analytics** — Historical ranking charts (30d/90d/all-time), review volume by platform, sentiment trends, CSV exports
- **Google Business Profile** — OAuth connect for review sync and business info (Yelp/Facebook coming soon)
- **Google Sign-In** — One-click Google OAuth login/registration alongside email+password

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, SWR, React Router v6, Recharts |
| Backend | Node.js 20, Express, TypeScript |
| Database | PostgreSQL 15 (primary), Redis 7 (cache + sessions) |
| Queue | Bull (scheduled data pulls, report generation) |
| PDF | Puppeteer (report rendering) |
| Email | Resend |
| Payments | Stripe (subscriptions, per-location billing) |
| Auth | JWT (access + refresh tokens) + Google OAuth 2.0 |
| External APIs | BrightLocal (rankings/citations), EmbedMyReviews (reviews) |
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
│   │   ├── jobs/            Bull queue workers + cron jobs
│   │   ├── middleware/       Auth, rate limiting, validation
│   │   └── utils/           JWT, crypto, logger, response helpers
├── frontend/
│   └── src/
│       ├── pages/           Route-level components
│       ├── components/      Shared UI components
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
