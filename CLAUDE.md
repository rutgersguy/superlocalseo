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

**Plan gating (Lite/Pro):** `clients.product_line` (`'lite' | 'pro'`, default `'pro'`) drives a two-tier split. The single source of truth is the capability map in `backend/src/config/planFeatures.ts` (mirrored in `frontend/src/config/planFeatures.ts` — keep them in sync). Backend: `enforcePlanGate` is mounted once per gated route prefix in `routes/index.ts` (it passes anonymous requests through, so **every gated handler must run its own `requireAuth`**); it populates `req.client` and calls `requireProPlan`. Frontend: `useClient()` exposes `isLite`/`isPro`; gate Pro-only SWR fetches on `(loading || isLite) ? null : url` to avoid transient 403s. `product_line` flips only on the `invoice.payment_succeeded` webhook (payment-gated). See `docs/LITE_PRO_PROGRESS.md`.

**External APIs:**
- **BrightLocal Data API** (`api.brightlocal.com`, `x-api-key` header, pay-per-request) — rankings (5 engines), geo-grid heatmap (coordinate-based), citation auditing (per-directory listing find). No subscription or campaign ID required.
- **BrightLocal Management API** (`tools.brightlocal.com`) — citation submission to 40+ directories only. Requires paid BL plan — pending confirmation. Not currently in use; guided manual workflow is the active fallback.
- **EmbedMyReviews** — **the review pipeline.** EMR holds its OWN approved Google Business Profile API access (confirmed by them 2026-07-14), so **our** pending GBP quota is irrelevant to reviews. Clients connect Google via a branded `connect-links` URL on `app.superlocalseo.com` (no EMR branding, no second login). **Tenancy = the EMR location**: every client's integration row holds the same shared agency key, so reads MUST be scoped by `clients.emr_location_id` or every client sees every other client's reviews (see migration `20260714000000`). Replies publish live via `POST /api/v1/reviews/{id}/reply` — no approval step. See `docs/INTEGRATIONS.md`.
- **Google OAuth** — sign-in + Business Profile connect (separate scopes). ⚠️ **The GBP connect is INERT and no longer used:** our Google Cloud project's GBP API quota request is still pending (`quota_limit_value: 0`), so `syncGBPReviews` returns nothing for every client. Reviews come from EMR instead; the route stays mounted but nothing in the UI points at it. **GBP Q&A is dead: Google discontinued the API 2025-11-03 — no vendor can do it. Do not build it.**
- ⚠️ **BrightLocal cannot post review replies** ("We don't support Review Response via API", 2026-07-14). `brightlocal.service.replyToReview()` → `/v4/rf/reply` and the `POST /reputation/reviews/:id/reply` route that calls it are built on an unsupported API and can never work. **EMR is the only reply path.** BrightLocal's role is GBP **business-info sync** (Active Sync — text only, no photos), which needs a paid **Manage** plan we don't yet have.
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
- **⚠️ `backend/src` is bind-mounted into the LIVE PROD API (nodemon + ts-node) — every save is a deploy.** A save that doesn't compile **crashes the production API** and users get a 504 until the next good save (this actually happened 2026-07-13). Host-side `tsc --noEmit` will NOT catch it, because it runs after your edits are done while the container compiles every intermediate save. So: **sequence edits so the file never compiles broken** (add imports first, define functions before calling them), and check `docker logs superlocalseo-api | grep TSError` after any backend edit. Being fixed properly in issue #131 (build the API to `dist/`, drop the bind mount).
- **Workers** are enabled by default. Setting `DISABLE_WORKERS=true` in the API environment will silently stop all background jobs (rankings pulls, report generation, etc.).
- **Rankings cooldown** key: `rankings:sync:cooldown:{clientId}` in Redis — stores the ISO timestamp of last manual trigger, enforces 24h window (**Pro**). **Lite gets exactly ONE manual scan, ever**, tracked in `clients.manual_scan_used_at` — deliberately in Postgres, **not** Redis, so a cache flush can't mint free scans. It's only marked used when the scan actually saved snapshots (a no-keyword or failed run must not cost their one shot).
- **Never hardcode prices or the setup fee in UI.** Derive from `productLine`. This has shipped to prod twice (#113, #125). The $499 setup fee is **waived** (`STRIPE_SETUP_FEE_ENABLED` unset) and trials run as **Pro** — so a trialing client has not chosen a plan and must not be shown one as "theirs". See `docs/PRICING.md`.
- **BrightLocal dual-API**: Data API and Management API are completely separate base URLs and auth headers. Data API uses `x-api-key` header on `api.brightlocal.com`. Management API (not currently active) uses `api-key` query param on `tools.brightlocal.com`. Never mix them up.
- **PDF reports** use `page-break-before: always` CSS for section breaks. Body background must be `#ffffff` (not `#f3f4f6`) to avoid grey bleed areas.

## GitHub

```bash
# Issues / PRs (GH_TOKEN is in env as GH_ISSUES_API_KEY)
GH_TOKEN=$GH_ISSUES_API_KEY gh issue list --repo rutgersguy/superlocalseo
GH_TOKEN=$GH_ISSUES_API_KEY gh issue create --repo rutgersguy/superlocalseo ...
GH_TOKEN=$GH_ISSUES_API_KEY gh issue close <number> --repo rutgersguy/superlocalseo
```
