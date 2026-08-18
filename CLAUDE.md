# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Host doctrine — `/root/CLAUDE.md`.** Machine-wide rules live there: the deploy-source map,
> credential setup, the testing bar (*"working" means you ran it and saw the expected output*),
> the commit-and-survive-a-rebuild requirement, and triage order.
> **This repo is outside `/root`, so that file is NOT auto-loaded — read it at the start of any
> non-trivial task here.** This file governs *how* to build in this repo; for anything ambiguous
> or unstated here, defer to `/root/CLAUDE.md`.

## Common Commands

```bash
# Start all services
docker compose up -d

# DEPLOY — use the script. It runs the preflight guards, backs up the database
# and verifies the site afterwards, none of which is optional and all of which
# is easy to skip by hand. See "Deploying" below.
scripts/deploy.sh
scripts/deploy.sh --migrate      # only when there are pending migrations

# Deploy by hand (equivalent, if you need the pieces). REBUILD, never `restart`:
# backend/src is no longer bind-mounted (#131), so `restart` re-runs the OLD
# image and silently ships nothing. A file that doesn't compile fails here and
# never reaches the container.
docker compose build api && docker compose up -d --force-recreate --no-deps api

# Deploy the frontend — also a rebuild (production static build since #119)
docker compose build web && docker compose up -d --force-recreate --no-deps web

# Restart a single service after config-only changes (use up --force-recreate for volume changes)
docker compose restart api
docker compose up -d --force-recreate --no-deps web

# Local dev with hot reload — explicit overlay, never auto-loaded
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d api

# View logs
docker compose logs -f api
docker compose logs -f web

# Frontend type-check
docker exec superlocalseo-web npx tsc --noEmit

# Run DB migrations (production image has no knex CLI and no knexfile.ts)
docker exec superlocalseo-api node dist/db/migrate.js          # apply
docker exec superlocalseo-api node dist/db/migrate.js status   # report only
docker exec superlocalseo-api node dist/db/migrate.js rollback # undo last batch

# Access DB directly
psql postgresql://slseo:slseo@localhost:5433/superlocalseo
```

## Deploying

Run **`scripts/deploy.sh`**. It preflights, backs up, builds, recreates and verifies.
`scripts/deploy-preflight.sh` runs the checks alone and also runs in CI, so a
regression is caught in the PR rather than at deploy time.

Three rules, all of which fail *silently* when broken:

1. **Never `docker compose down`.** ~20 long-lived containers share this host and
   several serve unrelated production stacks. Down-ing to get a clean state takes
   them with it.
2. **Always `--no-deps`.** Without it, recreating `api` also restarts postgres and
   redis — unnecessary downtime, and how trap 3 below reaches a database container
   that was otherwise fine.
3. **Always `--force-recreate`, never a reload.** A container started from an old
   image keeps serving old code, and single-file mounts are inode-pinned, so a
   reload re-reads the *original* file and reports success.

### The two host traps (#165)

Both are documented in `/root/CLAUDE.md` as standing traps 3 and 4. Both fired on
2026-08-16 and took n8n down for ~6 minutes. Documentation alone did not prevent
them, which is why `deploy-preflight.sh` asserts them:

- **Shell variables override `.env` during compose interpolation.** Compose resolves
  `${VAR}` from the shell *first*. The root shell here exports a stale
  `POSTGRES_PASSWORD`. **This repo is currently immune** — neither compose file uses
  `${}` interpolation at all, and config arrives via `env_file`, which is not
  subject to shell override. Verified empirically: `docker compose config` is
  byte-identical with and without the variable set. The preflight fails if anyone
  introduces interpolation.

- **Single-file bind mounts are pinned to the inode.** Mounting a *file* binds its
  inode; editors that write-and-rename change it, so the container keeps serving
  the original. This is how `/root/n8n/nginx/nginx.conf` — the proxy in front of
  `superlocalseo.com` — drifted for two and a half months. **This repo is currently
  immune**: it has no bind mounts at all, only named volumes. The preflight fails if
  anyone adds a file mount, and its `--runtime` mode compares host and container
  inodes for any that exist.

Both guards are tested by injecting each trap into a copy of the compose file and
confirming the script fails — a guard that has only ever passed is unproven.

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
- **API deploys are a REBUILD, not a restart.** `backend/src` used to be bind-mounted into the
  live API with nodemon + ts-node, which made every save an instant production deploy — a save
  that didn't compile crash-looped the API and returned 504 to real users (this happened
  2026-07-13). Fixed in issue #131: the API now runs `node dist/index.js` from a built image with
  no source mount. **`docker compose restart api` now silently re-runs the OLD code** — always
  `docker compose build api && docker compose up -d --no-deps api`. A broken file fails the build
  and never reaches the container.
- **Signature-verifying webhooks must live under `/webhooks/*`.** That prefix is mounted with
  `express.raw()` *before* the global JSON parser (`app.ts`). Anything under `/api` is parsed by
  `express.json()` first, which sets `req._body = true` and makes a route-level `express.raw()` a
  silent no-op — the handler then receives a parsed object and every signature check fails. That
  broke the Stripe webhook in production for weeks (#147): no event was ever processed, so paying
  did not activate a plan. `/api/billing/webhook` still works via an explicit exemption
  (`RAW_BODY_PATHS` in `app.ts`), but **new** webhooks should use `/webhooks/*` rather than
  extending that list.
- **Migrations changed with #131.** The production image installs with `--omit=dev` and never
  copies `knexfile.ts`, so there is no knex CLI and `npx knex migrate:latest` no longer works. Use
  `docker exec superlocalseo-api node dist/db/migrate.js` (`status` / `rollback` also accepted).
  Note the `knex_migrations` table was renamed from `*.ts` to `*.js` filenames as part of the
  switch — running migrations from a ts-node dev checkout against **this** database would now
  report the directory as corrupt. Dev should use its own database.
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
