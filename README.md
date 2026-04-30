# SuperLocalSEO

Enterprise-grade local SEO platform for service businesses (plumbers, HVAC, electricians). Aggregates ranking data, reviews, and citations into a unified dashboard with automated monthly PDF reports.

**Live at:** [superlocalseo.com](https://superlocalseo.com)

---

## What It Does

- **Rankings** — Daily keyword rank tracking via BrightLocal, stored historically in our DB
- **Reviews** — Multi-platform review aggregation via EmbedMyReviews, refreshed every 6 hours
- **Citations** — Directory listing completeness and NAP accuracy monitoring
- **Reports** — Automated monthly PDF reports delivered by email to clients
- **Historical data** — All BrightLocal snapshots stored permanently (BrightLocal provides no history)

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, SWR, React Router v6, React Hook Form, Zod |
| Backend | Node.js 20, Express, TypeScript |
| Database | PostgreSQL 15 (primary), Redis 7 (cache + sessions) |
| Queue | Bull (scheduled BrightLocal/EMR pulls, report generation) |
| PDF | Puppeteer (report rendering) |
| Email | SendGrid |
| Payments | Stripe (subscriptions, per-location billing) |
| External | BrightLocal API, EmbedMyReviews API |
| DevOps | Docker, Docker Compose, GitHub Actions, Nginx |

## Local Development

```bash
git clone https://github.com/rutgersguy/superlocalseo.git
cd superlocalseo
cp .env.example .env        # fill in your keys
docker compose up -d        # starts postgres, redis, api, web, nginx
```

API available at `http://localhost:3000`  
Frontend at `http://localhost:5173`

See [docs/SETUP.md](docs/SETUP.md) for full local dev instructions.

## Project Structure

```
superlocalseo/
├── backend/          Express API server
├── frontend/         React SPA
├── docs/             Architecture, setup, API reference
├── .github/          CI/CD workflows and issue templates
├── docker-compose.yml
└── nginx.conf
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — System design, data flow, DB schema
- [Setup](docs/SETUP.md) — Local development guide
- [API Reference](docs/API.md) — Endpoint specifications
- [Pricing Model](docs/PRICING.md) — Location-based billing logic
- [Deployment](docs/DEPLOYMENT.md) — Production deployment playbook
- [Roadmap](ROADMAP.md) — Phase 0–4 delivery plan
