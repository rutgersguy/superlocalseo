# SuperLocalSEO — Go-Live Checklist

Run this checklist from top to bottom before directing any real traffic.

---

## 1. Infrastructure

- [ ] VPS has ≥ 4 GB RAM, ≥ 2 vCPUs
- [ ] Docker Compose prod file is `docker-compose.prod.yml` (not dev)
- [ ] Volumes mounted for `/app/data/reports` and Postgres data
- [ ] Firewall: only ports 80/443 open externally; 3000/5432/6379 internal only
- [ ] Swap space configured (≥ 2 GB) as OOM safety net

## 2. DNS & TLS

- [ ] `superlocalseo.com` A record points to VPS IP
- [ ] `www.superlocalseo.com` CNAME → `superlocalseo.com`
- [ ] Cloudflare SSL mode: **Full (strict)**
- [ ] TLS 1.2 minimum enforced in Cloudflare
- [ ] HSTS enabled (Cloudflare or nginx)
- [ ] `curl -I https://superlocalseo.com` returns `200` with `strict-transport-security` header

## 3. Environment Variables

Copy `.env.example` to `.env.prod` and fill every value:

- [ ] `NODE_ENV=production`
- [ ] `APP_URL=https://superlocalseo.com`
- [ ] `PUBLIC_URL=https://superlocalseo.com`
- [ ] `DATABASE_URL` — production Postgres (strong password, separate DB user)
- [ ] `REDIS_URL` — production Redis
- [ ] `JWT_SECRET` — `openssl rand -hex 32`
- [ ] `JWT_REFRESH_SECRET` — `openssl rand -hex 32`
- [ ] `ENCRYPTION_KEY` — `openssl rand -hex 32`
- [ ] `STRIPE_SECRET_KEY` — **live** key (`sk_live_…`)
- [ ] `STRIPE_PUBLISHABLE_KEY` — **live** key (`pk_live_…`)
- [ ] `STRIPE_WEBHOOK_SECRET` — from Stripe dashboard webhook endpoint
- [ ] All `STRIPE_*_PRICE_ID` — live price IDs from Stripe dashboard
- [ ] `RESEND_API_KEY` — production key, from-domain verified
- [ ] `RESEND_FROM_EMAIL=hello@superlocalseo.com` (once email verified)
- [ ] `ANTHROPIC_API_KEY` — production key with billing configured
- [ ] `BRIGHTLOCAL_API_KEY`
- [ ] `EMBEDMYREVIEWS_API_KEY`
- [ ] `EMBEDMYREVIEWS_WEBHOOK_SECRET` — set in EMR dashboard, paste here
- [ ] `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — production OAuth app
- [ ] `GOOGLE_PLACES_API_KEY` — key restricted to Places API, production quota
- [ ] `SENTRY_DSN` — from Sentry project settings

## 4. Stripe Configuration

- [ ] Live mode activated (toggle in Stripe dashboard)
- [ ] Webhook endpoint created: `https://superlocalseo.com/webhooks/stripe`
  - Events: `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`
- [ ] Tier 1/2/3 prices created in Stripe; price IDs in `.env.prod`
- [ ] Test checkout flow end-to-end with a real card in live mode

## 5. Email (Resend)

- [ ] Domain `superlocalseo.com` verified in Resend (SPF + DKIM records)
- [ ] `hello@superlocalseo.com` sending address verified
- [ ] Send a test verification email from the API: `POST /api/auth/register`
- [ ] Check spam score; ensure email lands in inbox

## 6. Google OAuth

- [ ] OAuth consent screen published (not in test mode)
- [ ] Authorised redirect URI: `https://superlocalseo.com/api/auth/google/callback`
- [ ] `https://superlocalseo.com` in authorised JavaScript origins
- [ ] Test Google sign-in flow in production

## 7. EmbedMyReviews Webhook

- [ ] Webhook URL registered in EMR dashboard: `https://superlocalseo.com/api/reviews/webhook`
- [ ] Events: `review.created`, `review.updated`
- [ ] Copy webhook secret from EMR → `EMBEDMYREVIEWS_WEBHOOK_SECRET` in env

## 8. Database

- [ ] Migrations applied: `docker exec superlocalseo-api node dist/db/migrate.js`
      (the production image has no knex CLI and no `knexfile.ts` — see issue #131)
- [ ] Seed data removed / not applied in production
- [ ] Postgres `max_connections` ≥ 100
- [ ] Daily backup cron active: `0 2 * * * /opt/superlocalseo/scripts/backup-db.sh`
- [ ] Test backup runs and restores: `pg_restore` to a throwaway DB

## 9. Monitoring

- [ ] Sentry project created; DSN in env
- [ ] Sentry frontend DSN in `frontend/.env.production` (`VITE_SENTRY_DSN`)
- [ ] Prometheus scraping `/api/metrics` (admin token required)
- [ ] Alert rule: error rate > 1% → PagerDuty / email
- [ ] Verify BullMQ workers running: `docker compose logs api | grep "workers started"`

## 10. Final Smoke Test

Run after deployment:

```bash
# Health checks
curl https://superlocalseo.com/api/health/live
curl https://superlocalseo.com/api/health/ready

# Register a test account
curl -X POST https://superlocalseo.com/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoke@example.com","password":"Password123!","businessName":"Smoke Test"}'
```

- [ ] Register → verify email → log in → onboarding wizard → dashboard all work
- [ ] Stripe test checkout (one-time test card `4242 4242 4242 4242`)
- [ ] Manual report generation: `POST /api/reports/generate`
- [ ] Check Sentry for any boot errors

## 11. Rollback Plan

If something breaks after deploy:

```bash
# Roll back to previous image
docker compose down
git checkout <previous-commit>
docker compose build api
docker compose up -d

# Roll back latest migration
docker exec superlocalseo-api node dist/db/migrate.js rollback
```

Keep the previous Docker image tagged (`docker tag superlocalseo-api:latest superlocalseo-api:prev`) before each deploy.
