# Local Development Setup

## Prerequisites

- Docker + Docker Compose
- Node.js 20+
- Git

## Quick Start

```bash
git clone https://github.com/rutgersguy/superlocalseo.git
cd superlocalseo
cp .env.example .env
```

Fill in `.env` (see required variables below), then:

```bash
docker compose up -d
```

Services:
- API: http://localhost:3000
- Frontend: http://localhost:5173 (Vite dev server)
- Postgres: localhost:5432
- Redis: localhost:6379

## Environment Variables

See `.env.example` for all variables. Required to start:

```
DATABASE_URL=postgresql://slseo:slseo@postgres:5432/superlocalseo
REDIS_URL=redis://redis:6379
JWT_SECRET=<generate: openssl rand -hex 32>
JWT_REFRESH_SECRET=<generate: openssl rand -hex 32>
ENCRYPTION_KEY=<generate: openssl rand -hex 32>
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
SENDGRID_API_KEY=SG....
APP_URL=http://localhost:5173
```

Optional (needed for data pulls):
```
BRIGHTLOCAL_API_KEY=...
EMBEDMYREVIEWS_API_KEY=...
```

## Running Migrations

```bash
docker exec superlocalseo-api npx knex migrate:latest
docker exec superlocalseo-api npx knex seed:run   # dev seed data
```

## Running Tests

```bash
# Backend unit tests
cd backend && npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

## Stripe Local Webhooks

Use Stripe CLI to forward webhooks in dev:

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

Copy the webhook secret it prints into `STRIPE_WEBHOOK_SECRET` in `.env`.
