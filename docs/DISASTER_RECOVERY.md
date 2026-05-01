# SuperLocalSEO — Disaster Recovery Runbook

**Last updated:** 2026-05-01  
**Owner:** Operator on-call

---

## 1. Overview

### Stack summary

| Component | Container | Storage | Notes |
|---|---|---|---|
| Express API | `superlocalseo-api` | `reports_data` volume | Node.js + BullMQ workers |
| React SPA | `superlocalseo-web` | — | Vite dev / nginx in prod |
| PostgreSQL 15 | `superlocalseo-postgres` | `pg_data` volume | Source of truth |
| Redis 7 | `superlocalseo-redis` | `redis_data` volume | Queue + token cache |
| Nginx | host or separate container | — | Reverse proxy + TLS |

### Recovery targets

| Scenario | RTO target | RPO target |
|---|---|---|
| Container crash (single service) | < 5 min | 0 (stateless restart) |
| API bug / bad deploy | < 10 min | 0 (rollback image) |
| Database corruption | < 1 hour | < 24 hours (nightly backup) |
| Full VPS loss | < 4 hours | < 24 hours (offsite backup) |
| Compromised credentials | < 30 min | n/a |

---

## 2. Incident Severity

| Level | Criteria | Response time | Examples |
|---|---|---|---|
| **P1** | All users locked out; data loss in progress | Immediate | DB down, VPS unreachable, active breach |
| **P2** | Degraded service; some users affected | < 30 min | API errors on specific routes, queue stuck, emails not sending |
| **P3** | Non-critical feature broken | < 4 hours | Report PDF fails, competitor sync down, widget 500 |

---

## 3. Diagnostics — First 5 Minutes

Run these before doing anything else:

```bash
# 1. Are containers running?
docker compose ps

# 2. Any recent errors?
docker compose logs api --tail=50 --since=10m
docker compose logs postgres --tail=20 --since=10m

# 3. Is the API responding?
curl -sf http://localhost:3000/api/health/live && echo OK || echo DEAD
curl -sf http://localhost:3000/api/health/ready && echo READY || echo NOT READY

# 4. Is Postgres accepting connections?
docker compose exec postgres pg_isready -U slseo -d superlocalseo

# 5. Is Redis alive?
docker compose exec redis redis-cli ping

# 6. Check disk space (Postgres dies silently when disk is full)
df -h /var/lib/docker
```

---

## 4. Runbooks by Failure Type

---

### 4.1 Container crash / service unreachable

**Symptoms:** `docker compose ps` shows a container as `Exit` or `Restarting`.

```bash
# Identify the failing container
docker compose ps

# Read its exit logs
docker compose logs <service-name> --tail=100

# Attempt a restart
docker compose restart <service-name>

# Verify recovery
curl -sf http://localhost:3000/api/health/live && echo RECOVERED
```

**If restart loops** (container exits immediately after starting):

```bash
# Pull the last crash reason
docker compose logs <service-name> --tail=200 | grep -E "Error|FATAL|OOM|Killed"

# Common causes:
#   OOM: increase Docker memory limit or add swap
#   Port conflict: another process on port 3000/5432/6379
#   Missing env var: check .env file is present and complete
#   Migration error: see §4.4
```

---

### 4.2 API returning 500 errors on all routes

**Symptoms:** Every API response is 500; logs show unhandled exception.

```bash
# 1. Identify the error
docker compose logs api --tail=100 | grep -i "error\|exception\|unhandled"

# 2. Check if DB connection is healthy
docker compose exec api node -e "
const { db } = require('./dist/db/connection');
db.raw('SELECT 1').then(() => { console.log('DB OK'); process.exit(0); })
  .catch(e => { console.error(e.message); process.exit(1); });
"

# 3. Quick rollback to last known-good image
docker compose down api
git log --oneline -5           # find previous commit
git checkout <previous-commit> -- backend/
docker compose build api
docker compose up -d api

# 4. Confirm recovery
curl http://localhost:3000/api/health/live
```

---

### 4.3 Database: cannot connect / connection pool exhausted

**Symptoms:** API logs show `ECONNREFUSED`, `too many clients`, or `connection refused`.

```bash
# Check Postgres container health
docker compose ps postgres
docker compose logs postgres --tail=50

# If container is running, check connection count
docker compose exec postgres psql -U slseo -d superlocalseo -c \
  "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"

# If connections are exhausted (default max is 100):
# Restart the API to flush its connection pool first
docker compose restart api
sleep 5
curl http://localhost:3000/api/health/ready

# If Postgres is down entirely:
docker compose restart postgres
# Wait for health check to pass before restarting API
docker compose up -d api
```

---

### 4.4 Database: migration failed / schema mismatch

**Symptoms:** API starts but crashes on first DB query; logs show `column does not exist` or `relation does not exist`.

```bash
# Check migration status
docker compose exec api npx knex migrate:list 2>&1

# Identify which migrations haven't run
# "Pending" migrations shown at the bottom

# Apply pending migrations
docker compose exec api npx knex migrate:latest

# If a migration errored mid-run (partial state), rollback and re-run:
docker compose exec api npx knex migrate:rollback
docker compose exec api npx knex migrate:latest

# NEVER rollback in production without a DB backup taken immediately before.
```

---

### 4.5 Database restore from backup

Use this for: corrupted data, accidental `DELETE`/`DROP`, full VPS recovery.

```bash
# 1. Stop the API so no writes occur during restore
docker compose stop api

# 2. List available backups
ls -lht /var/backups/superlocalseo/

# 3. Pick the most recent clean backup
BACKUP=/var/backups/superlocalseo/superlocalseo_20260501_020000.sql.gz

# 4. Drop and recreate the database
docker compose exec postgres psql -U slseo -c "DROP DATABASE IF EXISTS superlocalseo;"
docker compose exec postgres psql -U slseo -c "CREATE DATABASE superlocalseo;"

# 5. Restore
gunzip -c "$BACKUP" | docker compose exec -T postgres psql -U slseo -d superlocalseo

# 6. Re-run any migrations that post-date the backup
docker compose exec api npx knex migrate:latest

# 7. Restart API and verify
docker compose start api
curl http://localhost:3000/api/health/ready
```

**Verify backup integrity before an incident:**
```bash
# Test restore to a throwaway DB (run monthly)
gunzip -c /var/backups/superlocalseo/latest.sql.gz | \
  docker compose exec -T postgres psql -U slseo -d postgres -c \
  "CREATE DATABASE superlocalseo_test;" 2>&1 && \
  gunzip -c /var/backups/superlocalseo/latest.sql.gz | \
  docker compose exec -T postgres psql -U slseo -d superlocalseo_test
```

---

### 4.6 Redis down or data loss

Redis holds:
- Refresh token blocklist (JWT revocation)
- BullMQ job queues (rankings, citations, reviews, reports, competitors)

Redis data is **ephemeral by design** — losing it is recoverable.

```bash
# Restart Redis
docker compose restart redis

# Verify BullMQ workers reconnect automatically (they will on next job attempt)
docker compose logs api --tail=20 | grep -i "redis\|queue\|worker"

# If the queue is empty after restart, jobs will resume on their next cron schedule.
# To trigger an immediate pull (e.g. if rankings are 24h stale):
docker compose exec api node -e "
const { rankingsQueue } = require('./dist/jobs/queue');
rankingsQueue.add('manual-pull', {}).then(() => { console.log('queued'); process.exit(0); });
"
```

**Impact of Redis loss:**
- All logged-in sessions stay valid (JWTs are stateless; only blocklist is lost)
- Any previously revoked refresh tokens become valid again temporarily — mitigate by rotating `JWT_REFRESH_SECRET` if the loss was due to a breach

---

### 4.7 BullMQ workers not processing jobs

**Symptoms:** Rankings/reviews stale; `docker compose logs api` shows no job processing.

```bash
# Check if workers started at boot
docker compose logs api | grep "workers started"

# If missing, the API may have started with DISABLE_WORKERS=true (dev flag)
grep DISABLE_WORKERS .env

# Restart API to re-register workers
docker compose restart api
docker compose logs api --tail=30 | grep -E "worker|queue|cron"

# If a specific queue is stuck (jobs not dequeuing), inspect via Redis:
docker compose exec redis redis-cli LLEN "bull:reviews:wait"
docker compose exec redis redis-cli LLEN "bull:rankings:wait"

# Drain stuck jobs (nuclear — use only after verifying the queue is truly jammed):
docker compose exec redis redis-cli DEL "bull:reviews:wait"
# Workers will pick up on next cron tick
```

---

### 4.8 Full VPS failure / provisioning a replacement

Use when: the host is unrecoverable (hardware failure, provider incident).

**Prerequisites:** Backups are stored offsite (see §5 — configure S3/B2 sync).

```bash
# On the NEW VPS:

# 1. Install Docker + Docker Compose
curl -fsSL https://get.docker.com | sh
apt-get install -y docker-compose-plugin

# 2. Clone the repo
git clone https://github.com/rutgersguy/superlocalseo.git /opt/superlocalseo
cd /opt/superlocalseo

# 3. Copy .env.prod from secure storage (1Password / Vault)
cp /path/to/secure/.env.prod .env

# 4. Download latest backup from offsite storage
# (example using rclone to B2/S3 — configure rclone separately)
rclone copy backblaze:superlocalseo-backups/latest.sql.gz /var/backups/superlocalseo/

# 5. Start infrastructure (Postgres + Redis only first)
docker compose up -d postgres redis
sleep 10

# 6. Restore database (see §4.5)
BACKUP=/var/backups/superlocalseo/latest.sql.gz
gunzip -c "$BACKUP" | docker compose exec -T postgres psql -U slseo -d superlocalseo

# 7. Build and start API
docker compose build api
docker compose up -d api
docker compose exec api npx knex migrate:latest

# 8. Start frontend and nginx
docker compose up -d web
# Configure nginx + Cloudflare to point to new IP

# 9. Verify
curl https://superlocalseo.com/api/health/live
curl https://superlocalseo.com/api/health/ready
```

**Expected total time:** 60–90 minutes (dominated by DNS propagation if IP changes).

---

### 4.9 SSL/TLS certificate issues

SuperLocalSEO uses Cloudflare for TLS termination (Full Strict mode). Certificates are managed by Cloudflare and auto-renewed — no manual action needed in normal operation.

**If HTTPS stops working:**

```bash
# 1. Check Cloudflare dashboard — is the zone paused or in "Development mode"?
# 2. Confirm origin server responds on HTTP (Cloudflare → origin is HTTP)
curl -v http://<VPS_IP>:80/api/health/live

# 3. If using a local nginx with Let's Encrypt instead of Cloudflare:
certbot renew --dry-run
certbot renew
systemctl reload nginx
```

---

### 4.10 Stripe webhook failures

**Symptoms:** Subscriptions not updating after payment; `invoice.paid` events not reflected in DB.

```bash
# 1. Check Stripe dashboard → Developers → Webhooks → recent deliveries
# 2. Look for failed events and their error messages

# 3. Verify STRIPE_WEBHOOK_SECRET matches the endpoint's signing secret
grep STRIPE_WEBHOOK_SECRET .env

# 4. Test webhook delivery manually
stripe listen --forward-to localhost:3000/webhooks/stripe   # requires Stripe CLI

# 5. Replay failed events from Stripe dashboard (Events → filter by type → Resend)

# 6. If the subscription status is wrong in DB, manually correct it:
docker compose exec postgres psql -U slseo -d superlocalseo -c \
  "UPDATE clients SET subscription_status='active' WHERE stripe_customer_id='cus_XXXX';"
```

---

### 4.11 Compromised credentials / security incident

**Immediate actions (first 5 minutes):**

```bash
# 1. Rotate all secrets — generate new values and update .env
openssl rand -hex 32   # for JWT_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY

# 2. Restart API to pick up new secrets (invalidates ALL existing sessions)
docker compose restart api

# 3. If API key exposed (ANTHROPIC, BRIGHTLOCAL, EMBEDMYREVIEWS, STRIPE):
#    - Revoke key in provider dashboard FIRST
#    - Generate new key, update .env, restart
docker compose restart api

# 4. If database credentials exposed:
docker compose exec postgres psql -U slseo -c \
  "ALTER USER slseo WITH PASSWORD 'new-strong-password';"
# Update DATABASE_URL in .env and restart

# 5. If the VPS itself is compromised, snapshot and terminate.
#    Provision a new VPS (§4.8) rather than cleaning the infected one.
```

**Post-incident:**
- Review access logs: `docker compose logs api | grep '"status":200' | head -200`
- Check for unusual data access patterns in Postgres: `pg_stat_activity`, `pg_audit` if enabled
- Notify affected clients if PII was accessed
- File incident report (see §6)

---

### 4.12 High memory / OOM kills

**Symptoms:** Containers restart unexpectedly; `dmesg` shows `oom-killer`.

```bash
# Check current memory usage
docker stats --no-stream

# Identify the heaviest process
docker compose top api

# Common causes:
#   Puppeteer (PDF generation) leaks — each report spawns a Chrome instance
#   Large review pull (client with 10,000+ reviews)

# Immediate relief: add swap if not present
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Longer fix: add memory limits to docker-compose.prod.yml
# services:
#   api:
#     mem_limit: 1g
#     memswap_limit: 1g
```

---

## 5. Backup Configuration

### Automated nightly backup (required setup)

Add to root crontab (`crontab -e`):

```
0 2 * * * /opt/superlocalseo/scripts/backup-db.sh >> /var/log/superlocalseo-backup.log 2>&1
```

### Offsite sync (strongly recommended)

Backups on the same VPS are lost in a full host failure. Sync to Backblaze B2 or S3:

```bash
# Install rclone
curl https://rclone.org/install.sh | sudo bash

# Configure B2 bucket (interactive)
rclone config

# Add offsite sync to crontab (runs after backup)
30 2 * * * rclone sync /var/backups/superlocalseo/ backblaze:superlocalseo-backups/ >> /var/log/superlocalseo-backup.log 2>&1
```

### Backup verification schedule

| Frequency | Action |
|---|---|
| Weekly | Confirm backup file exists and is non-zero: `ls -lh /var/backups/superlocalseo/ | tail -3` |
| Monthly | Full restore test to throwaway DB (see §4.5) |
| On every deploy | Pre-deploy snapshot: `BACKUP_DIR=/var/backups/superlocalseo/pre-deploy /opt/superlocalseo/scripts/backup-db.sh` |

---

## 6. Post-Incident Review Template

File within 48 hours of any P1/P2 incident.

```
## Incident Report

**Date:** YYYY-MM-DD
**Duration:** HH:MM
**Severity:** P1 / P2 / P3
**Services affected:**
**Clients affected:** (count, not names)

### Timeline
- HH:MM — first alert / detection
- HH:MM — investigation started
- HH:MM — root cause identified
- HH:MM — mitigation applied
- HH:MM — service restored
- HH:MM — monitoring confirmed stable

### Root cause
(1–3 sentences: what broke and why)

### Impact
(What could users not do? Was any data lost or exposed?)

### Fix applied
(What change resolved the incident?)

### Prevention
- [ ] Action 1 (owner, due date)
- [ ] Action 2 (owner, due date)
```

---

## 7. Quick Reference

### Useful one-liners

```bash
# Tail all service logs simultaneously
docker compose logs -f --tail=20

# Restart everything cleanly (preserves volumes)
docker compose down && docker compose up -d

# Force-rebuild and restart API only
docker compose build api && docker compose up -d api

# Check how long each container has been running
docker compose ps --format "table {{.Name}}\t{{.Status}}"

# Count reviews in DB
docker compose exec postgres psql -U slseo -d superlocalseo -c \
  "SELECT COUNT(*) FROM reviews;"

# Check BullMQ queue depths
docker compose exec redis redis-cli KEYS "bull:*:wait" | \
  xargs -I{} sh -c 'echo -n "{}: "; docker compose exec redis redis-cli LLEN "{}"'

# List all active Stripe subscriptions (requires Stripe CLI)
stripe subscriptions list --status=active

# Trigger an immediate review pull (bypass 6-hour cron)
docker compose exec redis redis-cli LPUSH "bull:reviews:wait" \
  '{"name":"manual-pull","data":{},"opts":{}}'
```

### Health check URLs

| URL | Expected |
|---|---|
| `GET /api/health/live` | `200 {"status":"ok"}` |
| `GET /api/health/ready` | `200` (checks DB + Redis) |
| `GET /api/prom-metrics` | `200 text/plain` (requires admin Bearer token) |
