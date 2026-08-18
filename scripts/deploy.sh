#!/usr/bin/env bash
#
# Production deploy for SuperLocalSEO (#165).
#
# Exists because the correct incantation is not the obvious one, and getting it
# wrong is silent. Three rules are baked in rather than remembered:
#
#   1. NEVER `docker compose down`. ~20 long-lived containers share this host and
#      several serve other production stacks. Down-ing to "get a clean state"
#      takes unrelated services with it.
#
#   2. ALWAYS `--no-deps`. Without it, recreating the api also restarts postgres
#      and redis. That is both unnecessary downtime and how trap 3 (shell vars
#      overriding .env) reaches a database container that was otherwise fine.
#
#   3. ALWAYS `--force-recreate`, never a reload. A container started from an old
#      image keeps serving old code, and single-file mounts are inode-pinned so a
#      reload re-reads the ORIGINAL file and reports success.
#
# Migrations stay MANUAL and opt-in via --migrate. They are not idempotent in
# the way a restart is, and running them by reflex during a routine deploy is
# how an unreviewed schema change reaches production.
#
# Usage:
#   scripts/deploy.sh                 # preflight, build, recreate api+web, verify
#   scripts/deploy.sh --migrate       # ... and run pending migrations first
#   scripts/deploy.sh --skip-build    # recreate from images already built

set -euo pipefail
cd "$(dirname "$0")/.."

MIGRATE=0
BUILD=1
for arg in "$@"; do
  case "$arg" in
    --migrate) MIGRATE=1 ;;
    --skip-build) BUILD=0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

SERVICES="api web"
step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

step "Preflight"
./scripts/deploy-preflight.sh --runtime

step "Backup database"
# Before anything, and before migrations especially. Cheap at this size, and the
# one thing that cannot be reconstructed afterwards.
mkdir -p /root/backups/superlocalseo
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DUMP="/root/backups/superlocalseo/deploy-$STAMP.sql.gz"
docker exec superlocalseo-postgres pg_dump -U slseo -d superlocalseo | gzip > "$DUMP"
# A dump that cannot be read is not a backup — but verify it WITHOUT a
# short-circuiting pipe. `zcat | head -20 | grep -q` looks correct and is not:
# head and grep -q both exit early, zcat takes SIGPIPE, and `set -o pipefail`
# turns that into a failed pipeline. The first run of this script aborted on a
# backup that was completely fine.
if ! gzip -t "$DUMP" 2>/dev/null; then
  echo "Backup at $DUMP is not a valid gzip archive — aborting" >&2
  exit 1
fi
# grep -c consumes the whole stream, so no SIGPIPE. Also a better check than a
# header string: it proves the dump has real content, not just a preamble.
tables=$(zcat "$DUMP" | grep -c '^CREATE TABLE' || true)
if [[ "${tables:-0}" -lt 10 ]]; then
  echo "Backup at $DUMP has only ${tables:-0} tables — aborting" >&2
  exit 1
fi
echo "  $DUMP ($(du -h "$DUMP" | cut -f1)), gzip ok, $tables tables"

if [[ $BUILD -eq 1 ]]; then
  step "Build images"
  docker compose build $SERVICES
fi

if [[ $MIGRATE -eq 1 ]]; then
  step "Migrations"
  NET=$(docker inspect superlocalseo-api --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
  docker run --rm --network "$NET" --env-file .env -e NODE_ENV=production \
    superlocalseo-api node dist/db/migrate.js status
  docker run --rm --network "$NET" --env-file .env -e NODE_ENV=production \
    superlocalseo-api node dist/db/migrate.js
else
  step "Migrations skipped (pass --migrate to run them)"
fi

step "Recreate $SERVICES"
# --no-deps and --force-recreate are the point; see the header.
docker compose up -d --force-recreate --no-deps $SERVICES

step "Verify"
sleep 10
code=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' https://superlocalseo.com/ || echo 000)
api=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' -X POST https://superlocalseo.com/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"x@y.z","password":"n"}' || echo 000)
echo "  site HTTP $code"
echo "  api  HTTP $api (422 = reached and validating)"

errs=$(docker logs superlocalseo-api --since 2m 2>&1 | grep -c '"level":"error"' || true)
echo "  api errors since restart: $errs"

# A 5xx or an unreachable site is a failed deploy even though every command
# above exited 0.
if [[ "$code" != "200" ]] || [[ "$api" == "000" ]] || [[ "$api" =~ ^5 ]]; then
  echo
  echo "DEPLOY FAILED verification — site $code, api $api"
  echo "Roll back with: docker compose up -d --force-recreate --no-deps $SERVICES"
  echo "Database backup: $DUMP"
  exit 1
fi

echo
echo "Deploy OK"
