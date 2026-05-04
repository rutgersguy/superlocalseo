# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

```bash
# Start all services
docker compose up -d

# Restart a single service after config changes (use up --force-recreate for volume changes)
docker compose restart api
docker compose up -d --force-recreate web

# View logs
docker compose logs -f api
docker compose logs -f web

# Frontend type-check
docker exec superlocalseo-web npx tsc --noEmit

# Run DB migrations
docker exec superlocalseo-api npx knex migrate:latest

# Access DB directly
psql postgresql://slseo:slseo@localhost:5433/superlocalseo
```

## Architecture

Monorepo: `backend/` (Express API) + `frontend/` (React SPA) + `nginx.conf` proxy.

**Data flow:** Vite dev server on :5173 → Nginx proxies `/api/*` to Express on :3000 → PostgreSQL + Redis. BullMQ workers run inside the API container (same process).

**Auth:** Bearer JWT tokens only — no cookies. `apiFetch()` in `frontend/src/services/api.ts` attaches the token and handles refresh. Never use `window.location.href` for authenticated API calls; always use `apiFetch` with `rawResponse: true` for file downloads.

**Design system:** Tailwind with custom tokens. Use `slate-*` (not `gray-*`), `shadow-card` / `shadow-card-md`, and `brand-*` color tokens. Full-width page layouts — no `max-w-3xl mx-auto` wrappers inside dashboard pages.

**External APIs:**
- **BrightLocal** — rankings, citations, local SEO audits, location provisioning. All rank/citation data flows through here.
- **EmbedMyReviews** — review aggregation, 6h polling + webhook.
- **Google OAuth** — sign-in + Business Profile connect (separate scopes).
- **Stripe** — subscriptions + per-location billing.
- **Resend** — transactional email + monthly report delivery.
- **Puppeteer/Chromium** — PDF report generation (Alpine: `apk add chromium`, `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`).

## Key Files

| File | Purpose |
|---|---|
| `frontend/src/services/api.ts` | `apiFetch` + `fetcher` (SWR) — all API calls go here |
| `frontend/src/layouts/DashboardLayout.tsx` | Sidebar nav + topbar shell |
| `backend/src/middleware/auth.ts` | `requireAuth` — checks `Authorization: Bearer <token>` |
| `backend/src/jobs/` | BullMQ workers: rankings, citations, reviews, reports, audits |
| `backend/src/services/brightlocal.service.ts` | BrightLocal API wrapper |
| `docker-compose.yml` | Service definitions — `src/` AND `public/` are volume-mounted for the web container |

## Important Gotchas

- **`docker compose restart` does not apply volume changes.** Use `docker compose up -d --force-recreate <service>` after editing `docker-compose.yml`.
- **Static assets** in `frontend/public/` are served by Vite at `/`. Both `frontend/src` and `frontend/public` are bind-mounted into the web container.
- **Workers** are enabled by default. Setting `DISABLE_WORKERS=true` in the API environment will silently stop all background jobs (rankings pulls, report generation, etc.).
- **Rankings cooldown** key: `rankings:sync:cooldown:{clientId}` in Redis — stores the ISO timestamp of last manual trigger, enforces 24h window.
- **PDF reports** use `page-break-before: always` CSS for section breaks. Body background must be `#ffffff` (not `#f3f4f6`) to avoid grey bleed areas.

## GitHub

```bash
# Issues / PRs (GH_TOKEN is in env as GH_ISSUES_API_KEY)
GH_TOKEN=$GH_ISSUES_API_KEY gh issue list --repo rutgersguy/superlocalseo
GH_TOKEN=$GH_ISSUES_API_KEY gh issue create --repo rutgersguy/superlocalseo ...
GH_TOKEN=$GH_ISSUES_API_KEY gh issue close <number> --repo rutgersguy/superlocalseo
```
