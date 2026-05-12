# SuperLocalSEO — Deployment Guide

**Audience:** Developers deploying or maintaining a SuperLocalSEO instance  
**Scope:** Full production deployment from a fresh VPS to a live, SSL-secured service

---

## Architecture Overview

SuperLocalSEO runs as four Docker containers managed by Docker Compose:

| Container | Image | Port | Purpose |
|---|---|---|---|
| `superlocalseo-postgres` | `postgres:15-alpine` | 5433 (host) / 5432 (internal) | Primary database |
| `superlocalseo-redis` | `redis:7-alpine` | 6399 (host) / 6379 (internal) | Cache + BullMQ queues |
| `superlocalseo-api` | Custom (Node 20 + Chromium) | 3000 | Express API + BullMQ workers |
| `superlocalseo-web` | Custom (Vite/React) | 5173 (dev) / served via Nginx (prod) | Frontend SPA |

In production, Nginx (or Cloudflare Tunnel) sits in front, terminating TLS and proxying to the API container. The web container serves pre-built static files.

---

## Prerequisites

- VPS: **≥ 4 GB RAM, ≥ 2 vCPUs, ≥ 40 GB disk** (Ubuntu 22.04 LTS recommended)
- Docker Engine ≥ 24 and Docker Compose v2 (`docker compose` not `docker-compose`)
- Domain pointing at the VPS IP (A record for `superlocalseo.com`)
- All third-party API accounts provisioned (see [INTEGRATIONS.md](./INTEGRATIONS.md))

---

## Directory Structure

```
/opt/superlocalseo/
├── backend/
│   ├── Dockerfile
│   ├── src/
│   └── ...
├── frontend/
│   ├── Dockerfile
│   ├── src/
│   └── ...
├── docker-compose.yml          # Development
├── docker-compose.prod.yml     # Production
├── .env.example
├── .env                        # Gitignored — never commit
└── scripts/
    └── backup-db.sh
```

---

## Environment Variables

Copy `.env.example` to `.env` (development) or `.env.prod` (production) and fill every value.

```bash
cp .env.example .env
```

### Complete Variable Reference

```bash
# ── App ───────────────────────────────────────────────────────
NODE_ENV=production
PORT=3000
APP_URL=https://superlocalseo.com        # Used in email links + OAuth callbacks
PUBLIC_URL=https://superlocalseo.com     # Base for public-facing QR + audit URLs

# ── Database ──────────────────────────────────────────────────
DATABASE_URL=postgresql://slseo:STRONG_PASSWORD@postgres:5432/superlocalseo

# ── Redis ─────────────────────────────────────────────────────
REDIS_URL=redis://redis:6379

# ── Auth ──────────────────────────────────────────────────────
# Generate secrets: openssl rand -hex 32
JWT_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# ── Encryption (for API keys stored in DB) ────────────────────
# Generate: openssl rand -hex 32  — DO NOT CHANGE after data is written
ENCRYPTION_KEY=

# ── Stripe ────────────────────────────────────────────────────
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...          # From Stripe Dashboard → Webhooks
STRIPE_SETUP_PRICE_ID=                   # One-time setup fee price ID
STRIPE_BASE_PRICE_ID=                    # Base subscription price ID
STRIPE_LOCATION_PRICE_ID=               # Per-extra-location price ID

# ── Email (Resend) ────────────────────────────────────────────
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=hello@superlocalseo.com
RESEND_FROM_NAME=SuperLocalSEO

# ── BrightLocal ───────────────────────────────────────────────
BRIGHTLOCAL_API_KEY=                     # Data API key (api.brightlocal.com)

# ── DataForSEO ────────────────────────────────────────────────
DATAFORSEO_LOGIN=                        # Account login (email)
DATAFORSEO_PASSWORD=                     # Account password

# ── EmbedMyReviews ────────────────────────────────────────────
EMBEDMYREVIEWS_API_KEY=
EMBEDMYREVIEWS_WEBHOOK_SECRET=           # Copy from EMR dashboard

# ── Google ────────────────────────────────────────────────────
GOOGLE_CLIENT_ID=                        # OAuth 2.0 client ID
GOOGLE_CLIENT_SECRET=                    # OAuth 2.0 client secret
GOOGLE_PLACES_API_KEY=                   # Places API key (restrict to Places API)

# ── Anthropic ─────────────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...

# ── Storage ───────────────────────────────────────────────────
REPORTS_DIR=/app/data/reports            # Inside container; mapped to reports_data volume

# ── Monitoring ────────────────────────────────────────────────
SENTRY_DSN=                              # Backend Sentry DSN
```

**Critical rules:**
- `ENCRYPTION_KEY` cannot change after initial deployment — doing so corrupts all stored encrypted API keys.
- `JWT_SECRET` / `JWT_REFRESH_SECRET` rotation invalidates all active sessions.
- Never commit `.env` or `.env.prod` to git.

---

## Docker Compose Files

### Development (`docker-compose.yml`)

```yaml
# Mounts source code for hot reload; uses `target: dev`
# Postgres on :5433 (host), Redis on :6399, API on :3000, Web on :5173
```

Run dev environment:
```bash
docker compose up --build
```

### Production (`docker-compose.prod.yml`)

Key differences from dev:
- `target: production` in build args — builds minified JS, no dev dependencies
- No source volume mounts — code baked into image
- Nginx container added for TLS termination + static file serving
- `restart: always` (not `unless-stopped`)
- `--env-file .env.prod`

```yaml
# docker-compose.prod.yml
services:
  postgres:
    image: postgres:15-alpine
    container_name: superlocalseo-postgres
    restart: always
    environment:
      POSTGRES_DB: superlocalseo
      POSTGRES_USER: slseo
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pg_data:/var/lib/postgresql/data
    networks: [internal]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U slseo -d superlocalseo"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    container_name: superlocalseo-redis
    restart: always
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    networks: [internal]

  api:
    build:
      context: ./backend
      target: production
    container_name: superlocalseo-api
    restart: always
    env_file: .env.prod
    environment:
      - DATABASE_URL=postgresql://slseo:${DB_PASSWORD}@postgres:5432/superlocalseo
      - REDIS_URL=redis://redis:6379
      - PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
    volumes:
      - reports_data:/app/data/reports
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks: [internal, external]

  web:
    build:
      context: ./frontend
      target: production
      args:
        VITE_API_URL: https://superlocalseo.com
    container_name: superlocalseo-web
    restart: always
    networks: [internal]

  nginx:
    image: nginx:alpine
    container_name: superlocalseo-nginx
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
      - certbot_webroot:/var/www/certbot
    depends_on: [api, web]
    networks: [internal, external]

networks:
  internal:
  external:

volumes:
  pg_data:
  redis_data:
  reports_data:
  certbot_webroot:
```

---

## SSL / TLS Setup

### Option A: Cloudflare (Recommended)

1. Point DNS to VPS via Cloudflare (orange cloud = proxied).
2. Set SSL/TLS mode to **Full (strict)** in Cloudflare dashboard.
3. Enable **HSTS** under SSL/TLS → Edge Certificates.
4. Cloudflare handles certificates automatically. API container just listens on port 80 internally.

**Note:** With Cloudflare, real client IPs are in `CF-Connecting-IP` header. Ensure rate limiting reads this header, not `X-Forwarded-For`.

### Option B: Let's Encrypt + Certbot

```bash
# Install certbot
apt install certbot

# Issue certificate
certbot certonly --standalone -d superlocalseo.com -d www.superlocalseo.com

# Auto-renew (certbot adds this automatically, but verify)
systemctl status certbot.timer
```

Nginx config snippet for TLS:
```nginx
server {
    listen 443 ssl http2;
    server_name superlocalseo.com www.superlocalseo.com;

    ssl_certificate /etc/letsencrypt/live/superlocalseo.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/superlocalseo.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload";

    # API proxy
    location /api/ {
        proxy_pass http://api:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Webhooks
    location /webhooks/ {
        proxy_pass http://api:3000;
        proxy_set_header Host $host;
    }

    # QR redirects
    location /api/qr/r/ {
        proxy_pass http://api:3000;
    }

    # Frontend SPA
    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;
    }
}

server {
    listen 80;
    server_name superlocalseo.com www.superlocalseo.com;
    return 301 https://$host$request_uri;
}
```

---

## Database Migrations

Migrations live in `backend/src/db/migrations/` and use Knex.js.

### Run migrations

```bash
# Inside container (standard deploy step)
docker compose exec api npx knex migrate:latest

# Check current migration status
docker compose exec api npx knex migrate:list

# Roll back one migration (use with caution in production)
docker compose exec api npx knex migrate:rollback
```

### Migration naming convention

```
YYYYMMDDHHMMSS_description.ts
e.g.: 20260512010000_location_audits_lighthouse.ts
```

### Migration strategy for production deploys

1. **Always back up the database** before running migrations:
   ```bash
   docker compose exec postgres pg_dump -U slseo superlocalseo | gzip > backup-pre-migrate-$(date +%Y%m%d).sql.gz
   ```
2. Run migrations in a maintenance window for large table alterations.
3. New columns should be `NULLABLE` unless there's a default that covers existing rows.
4. Never delete or rename columns in a single deployment — use two-phase: (1) add new column + migrate data, (2) drop old column in next release.

---

## Deploying a New Version

### Standard deploy

```bash
# On the VPS
cd /opt/superlocalseo

# Pull latest code
git pull origin main

# Tag current images for rollback
docker tag superlocalseo-api:latest superlocalseo-api:prev
docker tag superlocalseo-web:latest superlocalseo-web:prev

# Rebuild and restart
docker compose -f docker-compose.prod.yml --env-file .env.prod up --build -d

# Run any pending migrations
docker compose -f docker-compose.prod.yml exec api npx knex migrate:latest

# Verify
curl -f https://superlocalseo.com/api/health/ready || echo "HEALTH CHECK FAILED"
```

### Zero-downtime consideration

Docker Compose single-node deploys have a brief restart window (~5–10 seconds). For true zero-downtime, use a load balancer with two API instances — but this is not yet necessary at current scale.

---

## Database Backup & Recovery

### Automated nightly backup

Create `/opt/superlocalseo/scripts/backup-db.sh`:

```bash
#!/bin/bash
set -e
BACKUP_DIR="/opt/superlocalseo/backups"
DATE=$(date +%Y%m%d-%H%M%S)
FILENAME="$BACKUP_DIR/superlocalseo-$DATE.sql.gz"

mkdir -p "$BACKUP_DIR"
docker compose -f /opt/superlocalseo/docker-compose.prod.yml exec -T postgres \
  pg_dump -U slseo superlocalseo | gzip > "$FILENAME"

# Keep 30 days of backups
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +30 -delete

echo "Backup complete: $FILENAME"
```

```bash
chmod +x /opt/superlocalseo/scripts/backup-db.sh

# Add to root crontab (run at 2 AM UTC daily)
echo "0 2 * * * /opt/superlocalseo/scripts/backup-db.sh >> /var/log/superlocalseo-backup.log 2>&1" | crontab -
```

### Restore from backup

```bash
BACKUP_FILE="/opt/superlocalseo/backups/superlocalseo-20260512-020000.sql.gz"

# Stop API to prevent writes during restore
docker compose stop api

# Restore
gunzip -c "$BACKUP_FILE" | docker compose exec -T postgres \
  psql -U slseo -d superlocalseo

# Restart
docker compose start api

# Verify
docker compose exec api npx knex migrate:list
```

### Off-site backup (recommended)

After local backup completes, sync to object storage:
```bash
# Example: rclone to S3-compatible storage
rclone copy /opt/superlocalseo/backups remote:superlocalseo-backups --max-age 31d
```

---

## Health Checks

| Endpoint | Auth | What It Checks |
|---|---|---|
| `GET /api/health/live` | None | Process is alive |
| `GET /api/health/ready` | None | DB connection + Redis ping succeed |

Both return `{ "status": "ok" }` on success, `500` on failure.

Use these for:
- Docker Compose `healthcheck` → container restarts if they fail
- Load balancer health checks
- Monitoring alerts (UptimeRobot, BetterStack, etc.)

---

## Monitoring Setup

### Sentry (Error Tracking)

1. Create a Sentry project (Node.js) and a Sentry project (React).
2. Add `SENTRY_DSN` (backend) and `VITE_SENTRY_DSN` (frontend build arg) to env.
3. Errors are automatically captured. Set up Slack/email alerts in Sentry for new issues.

### Prometheus

The API exposes metrics at `GET /api/prom-metrics` (requires `Authorization: Bearer <admin_token>` header).

Metrics available:
- `http_request_duration_seconds` — latency histogram by method/route/status
- `http_requests_total` — request counter
- Node.js runtime metrics (memory, CPU, event loop lag)
- BullMQ job queue depth (custom)

Add a Prometheus scrape job:
```yaml
scrape_configs:
  - job_name: superlocalseo
    scheme: https
    metrics_path: /api/prom-metrics
    bearer_token: <admin_token>
    static_configs:
      - targets: [superlocalseo.com]
```

### Uptime monitoring

Add `https://superlocalseo.com/api/health/ready` to an external uptime monitor (UptimeRobot free tier works). Alert threshold: down for > 2 minutes.

---

## Performance & Scaling

### Current single-node capacity

On a 4 GB VPS with the default configuration:
- Postgres: handles ~200 concurrent connections; Knex pool default is `min: 2, max: 10`
- Redis: 256 MB max memory (`allkeys-lru` policy in prod compose)
- BullMQ: workers run in the same API process; scale by adding more worker concurrency
- Puppeteer: PDF generation spawns Chromium; memory-intensive; max ~3 concurrent generations

### Scaling checklist (when needed)

1. **Database connections bottleneck:** Increase Knex pool `max` and Postgres `max_connections` (`postgresql.conf`).
2. **PDF generation OOM:** Move Puppeteer to a separate microservice or use a queue with concurrency=1.
3. **Horizontal API scaling:** Stateless API (JWT auth, Redis-backed sessions) supports multiple instances behind a load balancer. Redis session store is already shared.
4. **Database read scaling:** Add a read replica and route `SELECT` queries (rankings history, analytics) there.
5. **BullMQ across machines:** Redis is the shared state; workers can run on separate hosts with same `REDIS_URL`.

### Swap space

Always configure swap on the VPS as OOM protection:
```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

---

## Security Hardening

```bash
# Firewall: only 22, 80, 443 externally
ufw default deny incoming
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# Internal services (Postgres, Redis) must NOT be reachable externally
# Verify with: nmap -p 5433,6399 <vps_ip>  (should show filtered)
```

- Set `POSTGRES_PASSWORD` to a strong random password (not the dev default `slseo`).
- Use Docker `internal` network for Postgres/Redis; only expose API + Nginx externally.
- Rotate `JWT_SECRET` and `JWT_REFRESH_SECRET` if a breach is suspected (invalidates all sessions).
- Review Nginx/Cloudflare logs for unusual patterns before first traffic spike.

---

## First-Deploy Checklist

Run through [DEPLOY.md](./DEPLOY.md) in full before directing real traffic. That document covers Stripe configuration, Google OAuth consent screen, EMR webhook registration, DNS/TLS verification, and smoke tests.
