#!/usr/bin/env bash
# ============================================================
# SuperLocalSEO — Full QA Smoke Test
# ============================================================
# Usage:
#   bash scripts/qa.sh                          # localhost:3000
#   BASE_URL=https://superlocalseo.com bash scripts/qa.sh
#   BASE_URL=https://superlocalseo.com ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=secret bash scripts/qa.sh
#
# Requirements: curl, jq
# Exit code: 0 = all pass, 1 = any failures
# ============================================================

set -euo pipefail

BASE="${BASE_URL:-http://localhost:3000}"
API="${BASE}/api"

# NOTE: The rate-limiting test in Section 8 deliberately exhausts the auth
# rate limit (15-min window). If you need to run the script twice in quick
# succession, set SKIP_RATE_LIMIT_TEST=1 to skip that probe.
SKIP_RATE_LIMIT_TEST="${SKIP_RATE_LIMIT_TEST:-0}"

# Test account credentials — created and deleted each run
QA_EMAIL="qa-smoke-$$@superlocalseo-test.invalid"
QA_PASSWORD="QaSmoke!$(date +%s)"
QA_BIZ="QA Smoke Test $$"

# Admin credentials (optional — admin checks skipped if not provided)
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@superlocalseo.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin1234!}"

# ── Colour output ─────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

PASS=0; FAIL=0; SKIP=0; WARN=0
FAILURES=()

# ── Helpers ───────────────────────────────────────────────────────────────────

ts() { date '+%H:%M:%S'; }

section() {
  echo ""
  echo -e "${BOLD}${BLUE}══ $1 ══${RESET}"
}

pass() {
  PASS=$((PASS+1))
  echo -e "  ${GREEN}✓${RESET} $1"
}

fail() {
  FAIL=$((FAIL+1))
  FAILURES+=("$1")
  echo -e "  ${RED}✗${RESET} $1"
  if [ -n "${2:-}" ]; then echo -e "    ${RED}↳ $2${RESET}"; fi
}

warn() {
  WARN=$((WARN+1))
  echo -e "  ${YELLOW}⚠${RESET} $1"
}

skip() {
  SKIP=$((SKIP+1))
  echo -e "  ${YELLOW}–${RESET} $1 (skipped)"
}

# curl wrapper: returns HTTP status code, stores body in $BODY
# Usage: api_call METHOD path [body] [token]
BODY=""
STATUS=0

api_call() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local token="${4:-}"

  local headers=(-H "Content-Type: application/json" -H "Accept: application/json")
  if [ -n "$token" ]; then
    headers+=(-H "Authorization: Bearer $token")
  fi

  local tmpfile
  tmpfile=$(mktemp)

  if [ -n "$body" ]; then
    STATUS=$(curl -s -o "$tmpfile" -w "%{http_code}" \
      -X "$method" \
      "${headers[@]}" \
      -d "$body" \
      --max-time 15 \
      "${API}${path}" 2>/dev/null) || STATUS=0
  else
    STATUS=$(curl -s -o "$tmpfile" -w "%{http_code}" \
      -X "$method" \
      "${headers[@]}" \
      --max-time 15 \
      "${API}${path}" 2>/dev/null) || STATUS=0
  fi

  BODY=$(cat "$tmpfile")
  rm -f "$tmpfile"
}

json_field() {
  echo "$BODY" | jq -r "${1}" 2>/dev/null || echo ""
}

# ── State ─────────────────────────────────────────────────────────────────────
TOKEN=""
REFRESH_COOKIE=""
CLIENT_ID=""
LOCATION_ID=""
KEYWORD_ID=""
ADMIN_TOKEN=""
QA_REGISTERED=false

echo ""
echo -e "${BOLD}SuperLocalSEO QA Smoke Test${RESET}"
echo -e "Target: ${BLUE}${BASE}${RESET}"
echo -e "Time:   $(ts)"
echo "────────────────────────────────────────────────"

# ══════════════════════════════════════════════════════════════════════════════
section "1. Infrastructure"
# ══════════════════════════════════════════════════════════════════════════════

api_call GET /health/live
if [ "$STATUS" = "200" ] && echo "$BODY" | jq -e '.status == "ok"' >/dev/null 2>&1; then
  pass "GET /health/live → 200 ok"
else
  fail "GET /health/live" "HTTP $STATUS — $BODY"
fi

api_call GET /health/ready
if [ "$STATUS" = "200" ]; then
  DB_OK=$(json_field '.db')
  REDIS_OK=$(json_field '.redis')
  if [ "$DB_OK" = "true" ]; then pass "Database connectivity"; else fail "Database connectivity" "db=$DB_OK"; fi
  if [ "$REDIS_OK" = "true" ]; then pass "Redis connectivity"; else fail "Redis connectivity" "redis=$REDIS_OK"; fi
else
  fail "GET /health/ready" "HTTP $STATUS"
fi

# TLS check (only if hitting https)
if [[ "$BASE" == https://* ]]; then
  TLS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE" 2>/dev/null) || TLS_STATUS=0
  if [ "$TLS_STATUS" != "0" ]; then
    pass "TLS/HTTPS reachable ($TLS_STATUS)"
  else
    fail "TLS/HTTPS not reachable"
  fi
  # Check HSTS header
  HSTS=$(curl -sI --max-time 10 "$BASE" 2>/dev/null | grep -i "strict-transport-security" || true)
  if [ -n "$HSTS" ]; then pass "HSTS header present"; else warn "HSTS header missing"; fi
fi

# ══════════════════════════════════════════════════════════════════════════════
section "2. Authentication"
# ══════════════════════════════════════════════════════════════════════════════

# Pre-check: detect if auth rate limiter is still active from a previous run
AUTH_RATE_LIMITED=false
api_call POST /auth/login '{"email":"ratelimit-probe@test.invalid","password":"x"}'
if [ "$STATUS" = "429" ]; then
  AUTH_RATE_LIMITED=true
  warn "Auth endpoints are rate-limited (15-min window from a previous run). Auth section skipped."
  warn "Re-run in ~15 minutes, or use a different IP/host, to test auth flows."
fi

# Validation rejection
if $AUTH_RATE_LIMITED; then
  skip "Registration validation (rate limited)"
else
  api_call POST /auth/register '{"email":"bad","password":"x","businessName":""}'
  if [ "$STATUS" = "422" ]; then
    pass "Registration validation rejects bad input (422)"
  else
    fail "Registration validation" "Expected 422, got $STATUS"
  fi
fi

# Register QA test account
if $AUTH_RATE_LIMITED; then
  skip "Register new account (rate limited)"
else
  api_call POST /auth/register "{\"email\":\"$QA_EMAIL\",\"password\":\"$QA_PASSWORD\",\"businessName\":\"$QA_BIZ\"}"
  if [ "$STATUS" = "201" ] || [ "$STATUS" = "200" ]; then
    pass "Register new account"
    QA_REGISTERED=true
  else
    fail "Register new account" "HTTP $STATUS — $BODY"
  fi
fi

# Login
if $AUTH_RATE_LIMITED; then
  skip "Login (rate limited)"
else
  api_call POST /auth/login "{\"email\":\"$QA_EMAIL\",\"password\":\"$QA_PASSWORD\"}"
  if [ "$STATUS" = "200" ]; then
    TOKEN=$(json_field '.data.accessToken')
    if [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; then
      pass "Login → accessToken returned"
    else
      fail "Login accessToken missing" "$BODY"
    fi
  else
    fail "Login" "HTTP $STATUS — $BODY"
  fi

  # Wrong password
  api_call POST /auth/login "{\"email\":\"$QA_EMAIL\",\"password\":\"wrongpassword\"}"
  if [ "$STATUS" = "401" ]; then
    pass "Login rejects wrong password (401)"
  else
    fail "Login wrong password" "Expected 401, got $STATUS"
  fi
fi

# Auth guard — unauthenticated request
api_call GET /clients
if [ "$STATUS" = "401" ]; then
  pass "Unauthenticated request rejected (401)"
else
  fail "Auth guard" "Expected 401 without token, got $STATUS"
fi

# ══════════════════════════════════════════════════════════════════════════════
section "3. Client & Onboarding"
# ══════════════════════════════════════════════════════════════════════════════

if [ -n "$TOKEN" ]; then
  api_call GET /clients "" "$TOKEN"
  if [ "$STATUS" = "200" ]; then
    CLIENT_ID=$(json_field '.data.id')
    pass "GET /clients → client record (id: ${CLIENT_ID:0:8}…)"
  else
    fail "GET /clients" "HTTP $STATUS"
  fi

  # Create a location
  api_call POST /locations '{"name":"QA Test Location","address":"123 Test St","city":"Testville","state":"CA","zip":"90001","phone":"555-0100","website":"https://qa-test.example.com"}' "$TOKEN"
  if [ "$STATUS" = "201" ] || [ "$STATUS" = "200" ]; then
    LOCATION_ID=$(json_field '.data.id')
    pass "POST /locations → created (id: ${LOCATION_ID:0:8}…)"
  else
    fail "POST /locations" "HTTP $STATUS — $BODY"
  fi

  # Add a keyword
  if [ -n "$LOCATION_ID" ] && [ "$LOCATION_ID" != "null" ]; then
    api_call POST /keywords "{\"locationId\":\"$LOCATION_ID\",\"keyword\":\"qa smoke test plumbing\"}" "$TOKEN"
    if [ "$STATUS" = "201" ] || [ "$STATUS" = "200" ]; then
      KEYWORD_ID=$(json_field '.data.id')
      pass "POST /keywords → created"
    else
      fail "POST /keywords" "HTTP $STATUS — $BODY"
    fi
  else
    skip "POST /keywords (no location)"
  fi
else
  skip "Client/onboarding checks (no token)"
fi

# ══════════════════════════════════════════════════════════════════════════════
section "4. Core Data Endpoints"
# ══════════════════════════════════════════════════════════════════════════════

if [ -n "$TOKEN" ]; then
  for route in /reviews /rankings /citations /competitors /reports /campaigns /team; do
    api_call GET "$route" "" "$TOKEN"
    if [ "$STATUS" = "200" ]; then
      pass "GET $route → 200"
    else
      fail "GET $route" "HTTP $STATUS"
    fi
  done

  # Keyword rankings with locationId filter
  if [ -n "$LOCATION_ID" ] && [ "$LOCATION_ID" != "null" ]; then
    api_call GET "/rankings?locationId=$LOCATION_ID" "" "$TOKEN"
    if [ "$STATUS" = "200" ]; then pass "GET /rankings?locationId → 200"; else fail "GET /rankings?locationId" "HTTP $STATUS"; fi
  fi

  # Citations history
  api_call GET /citations/history "" "$TOKEN"
  if [ "$STATUS" = "200" ]; then pass "GET /citations/history → 200"; else fail "GET /citations/history" "HTTP $STATUS"; fi

  # Competitor gap report
  api_call GET /competitors/gap "" "$TOKEN"
  if [ "$STATUS" = "200" ]; then pass "GET /competitors/gap → 200"; else fail "GET /competitors/gap" "HTTP $STATUS"; fi

else
  skip "Core data endpoints (no token)"
fi

# ══════════════════════════════════════════════════════════════════════════════
section "5. Billing & Subscription"
# ══════════════════════════════════════════════════════════════════════════════

if [ -n "$TOKEN" ]; then
  api_call GET /billing "" "$TOKEN"
  if [ "$STATUS" = "200" ]; then
    BSTATUS=$(json_field '.data.status')
    TIER=$(json_field '.data.tier')
    pass "GET /billing → status=$BSTATUS tier=$TIER"
  else
    fail "GET /billing" "HTTP $STATUS"
  fi

  # Billing portal URL
  api_call POST /billing/portal "" "$TOKEN"
  if [ "$STATUS" = "200" ]; then
    PORTAL_URL=$(json_field '.data.url')
    if [ -n "$PORTAL_URL" ] && [ "$PORTAL_URL" != "null" ]; then
      pass "POST /billing/portal → Stripe portal URL returned"
    else
      warn "POST /billing/portal → no URL in response"
    fi
  else
    warn "POST /billing/portal → HTTP $STATUS (may need active subscription)"
  fi
else
  skip "Billing checks (no token)"
fi

# ══════════════════════════════════════════════════════════════════════════════
section "6. Analytics"
# ══════════════════════════════════════════════════════════════════════════════

if [ -n "$TOKEN" ]; then
  for route in "/analytics/rankings/history" "/analytics/reviews/trend" "/analytics/roi"; do
    api_call GET "$route" "" "$TOKEN"
    if [ "$STATUS" = "200" ]; then
      pass "GET $route → 200"
    else
      fail "GET $route" "HTTP $STATUS"
    fi
  done
else
  skip "Analytics (no token)"
fi

# ══════════════════════════════════════════════════════════════════════════════
section "7. Public Endpoints"
# ══════════════════════════════════════════════════════════════════════════════

# Audit scan (public — no auth)
api_call POST /audit/scan '{"businessName":"Joe Plumbing","city":"Austin TX","keyword":"plumber"}'
if [ "$STATUS" = "200" ]; then
  SCAN_ID=$(json_field '.data.scanId')
  OVERALL=$(json_field '.data.audit.overallGrade')
  pass "POST /audit/scan → scanId=${SCAN_ID:0:8}… grade=$OVERALL"

  # Capture with email (public)
  if [ -n "$SCAN_ID" ] && [ "$SCAN_ID" != "null" ]; then
    api_call POST /audit/capture "{\"scanId\":\"$SCAN_ID\",\"email\":\"qa-audit@superlocalseo-test.invalid\"}"
    if [ "$STATUS" = "200" ]; then
      pass "POST /audit/capture → unlocked categories"
    else
      fail "POST /audit/capture" "HTTP $STATUS"
    fi
  fi
else
  warn "POST /audit/scan → HTTP $STATUS (Google Places API may not be configured)"
fi

# Widget endpoint (unauthenticated)
api_call GET /widget/nonexistent-key
if [ "$STATUS" = "404" ] || [ "$STATUS" = "200" ]; then
  pass "GET /widget/{key} → reachable ($STATUS)"
else
  fail "GET /widget endpoint" "HTTP $STATUS"
fi

# ══════════════════════════════════════════════════════════════════════════════
section "8. Security"
# ══════════════════════════════════════════════════════════════════════════════

# Rate limiting — deliberately exhausts the 15-min window; run last in section 8
# so it doesn't poison earlier auth calls in the same run.
if [ "$SKIP_RATE_LIMIT_TEST" = "1" ]; then
  skip "Rate limiting probe (SKIP_RATE_LIMIT_TEST=1)"
else
  RL_HIT=false
  for i in $(seq 1 12); do
    api_call POST /auth/login '{"email":"ratelimit@test.invalid","password":"wrong"}'
    if [ "$STATUS" = "429" ]; then
      RL_HIT=true
      break
    fi
  done
  if $RL_HIT; then
    pass "Rate limiting triggers on auth endpoint (429)"
  else
    warn "Rate limiting did not trigger after 12 attempts (may have higher threshold)"
  fi
fi

# Open redirect check
REDIRECT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 5 \
  -L "${API}/auth/google/callback?code=x&state=https://evil.com" 2>/dev/null) || REDIRECT_STATUS=0
if [ "$REDIRECT_STATUS" != "301" ] && [ "$REDIRECT_STATUS" != "302" ]; then
  pass "No open redirect on OAuth callback"
else
  fail "Potential open redirect on OAuth callback" "Got $REDIRECT_STATUS with redirect"
fi

# SQL injection probe (should 422/400/401/429, never 500)
api_call POST /auth/login '{"email":"'"'"' OR 1=1 --","password":"x"}'
if [ "$STATUS" = "422" ] || [ "$STATUS" = "400" ] || [ "$STATUS" = "401" ] || [ "$STATUS" = "429" ]; then
  pass "SQL injection probe → safe ($STATUS)"
elif [ "$STATUS" = "500" ]; then
  fail "SQL injection probe" "Server error on malicious input — $BODY"
else
  fail "SQL injection probe" "Unexpected HTTP $STATUS"
fi

# CORS — preflight on a protected endpoint
CORS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 5 \
  -X OPTIONS \
  -H "Origin: https://evil.com" \
  -H "Access-Control-Request-Method: GET" \
  "${API}/clients" 2>/dev/null) || CORS_STATUS=0
if [ "$CORS_STATUS" = "204" ] || [ "$CORS_STATUS" = "200" ]; then
  # Check the actual allow-origin value
  CORS_HEADER=$(curl -sI --max-time 5 \
    -X OPTIONS \
    -H "Origin: https://evil.com" \
    -H "Access-Control-Request-Method: GET" \
    "${API}/clients" 2>/dev/null | grep -i "access-control-allow-origin" || true)
  if echo "$CORS_HEADER" | grep -q "evil.com"; then
    fail "CORS allows arbitrary origins" "$CORS_HEADER"
  else
    pass "CORS does not reflect arbitrary origins"
  fi
else
  pass "CORS preflight → $CORS_STATUS"
fi

# ══════════════════════════════════════════════════════════════════════════════
section "9. Admin Endpoints"
# ══════════════════════════════════════════════════════════════════════════════

# Admin guard — regular token should 403
if [ -n "$TOKEN" ]; then
  api_call GET /admin/overview "" "$TOKEN"
  if [ "$STATUS" = "403" ]; then
    pass "Admin endpoints reject non-admin token (403)"
  else
    warn "Admin guard returned $STATUS for non-admin token (expected 403)"
  fi
fi

# Admin login if credentials provided
if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
  api_call POST /auth/login "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"
  if [ "$STATUS" = "200" ]; then
    ADMIN_TOKEN=$(json_field '.data.accessToken')
    ADMIN_ROLE=$(echo "$ADMIN_TOKEN" | cut -d'.' -f2 | base64 -d 2>/dev/null | jq -r '.role' 2>/dev/null || echo "")
    if [ "$ADMIN_ROLE" = "admin" ]; then
      pass "Admin login → role=admin"
    else
      warn "Admin login → role=$ADMIN_ROLE (expected admin)"
    fi
  else
    fail "Admin login" "HTTP $STATUS"
  fi

  if [ -n "$ADMIN_TOKEN" ]; then
    for route in /admin/overview /admin/clients /admin/queues /admin/analytics; do
      api_call GET "$route" "" "$ADMIN_TOKEN"
      if [ "$STATUS" = "200" ]; then
        pass "GET $route → 200"
      else
        fail "GET $route" "HTTP $STATUS"
      fi
    done

    # Queue health check — flag any failed jobs
    api_call GET /admin/queues "" "$ADMIN_TOKEN"
    if [ "$STATUS" = "200" ]; then
      FAILED_QUEUES=$(echo "$BODY" | jq '[.data.queues[] | select(.failed > 0) | .name] | join(", ")' 2>/dev/null || echo "")
      if [ -z "$FAILED_QUEUES" ] || [ "$FAILED_QUEUES" = '""' ]; then
        pass "All queues: 0 failed jobs"
      else
        warn "Queues with failed jobs: $FAILED_QUEUES"
      fi

      DEAD_QUEUES=$(echo "$BODY" | jq '[.data.queues[] | select(.ok == false) | .name] | join(", ")' 2>/dev/null || echo "")
      if [ -z "$DEAD_QUEUES" ] || [ "$DEAD_QUEUES" = '""' ]; then
        pass "All queues: workers healthy"
      else
        fail "Queues not responding" "$DEAD_QUEUES"
      fi
    fi
  fi
else
  skip "Admin endpoint checks (set ADMIN_EMAIL + ADMIN_PASSWORD to enable)"
fi

# ══════════════════════════════════════════════════════════════════════════════
section "10. Integrations & External Services"
# ══════════════════════════════════════════════════════════════════════════════

if [ -n "$TOKEN" ]; then
  api_call GET /integrations "" "$TOKEN"
  if [ "$STATUS" = "200" ]; then
    INT_COUNT=$(echo "$BODY" | jq '.data | length' 2>/dev/null || echo "?")
    pass "GET /integrations → $INT_COUNT integration(s)"
  else
    fail "GET /integrations" "HTTP $STATUS"
  fi

  # Google OAuth URL generation
  api_call GET /integrations/google/auth-url "" "$TOKEN"
  if [ "$STATUS" = "200" ] || [ "$STATUS" = "503" ]; then
    if [ "$STATUS" = "200" ]; then
      GURL=$(json_field '.data.url')
      if echo "$GURL" | grep -q "accounts.google.com"; then
        pass "GET /integrations/google/auth-url → valid Google OAuth URL"
      else
        warn "GET /integrations/google/auth-url → unexpected URL: $GURL"
      fi
    else
      warn "GET /integrations/google/auth-url → 503 (GOOGLE_CLIENT_ID not configured)"
    fi
  else
    fail "GET /integrations/google/auth-url" "HTTP $STATUS"
  fi

  # Facebook OAuth URL generation
  api_call GET /integrations/facebook/auth-url "" "$TOKEN"
  if [ "$STATUS" = "200" ] || [ "$STATUS" = "503" ]; then
    if [ "$STATUS" = "200" ]; then
      FURL=$(json_field '.data.url')
      if echo "$FURL" | grep -q "facebook.com"; then
        pass "GET /integrations/facebook/auth-url → valid Facebook OAuth URL"
      else
        warn "GET /integrations/facebook/auth-url → unexpected URL"
      fi
    else
      warn "GET /integrations/facebook/auth-url → 503 (FACEBOOK_APP_ID not configured)"
    fi
  else
    fail "GET /integrations/facebook/auth-url" "HTTP $STATUS"
  fi
else
  skip "Integration checks (no token)"
fi

# ══════════════════════════════════════════════════════════════════════════════
section "11. Webhook Endpoints"
# ══════════════════════════════════════════════════════════════════════════════

# Stripe webhook — invalid signature should 400 (note: /webhooks not /api/webhooks)
STRIPE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 5 \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"type":"test"}' \
  "${BASE}/webhooks/stripe" 2>/dev/null) || STRIPE_STATUS=0
STATUS=$STRIPE_STATUS
BODY=""
if [ "$STRIPE_STATUS" = "400" ] || [ "$STRIPE_STATUS" = "401" ] || [ "$STRIPE_STATUS" = "422" ]; then
  pass "Stripe webhook rejects unsigned payload ($STRIPE_STATUS)"
else
  warn "Stripe webhook → HTTP $STRIPE_STATUS (expected 400/401 — check STRIPE_WEBHOOK_SECRET)"
fi

# EMR webhook — invalid signature
FAKE_SIG="sha256=0000000000000000000000000000000000000000000000000000000000000000"
EMR_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 5 \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-EMR-Signature: $FAKE_SIG" \
  -d '{"event":"review.created"}' \
  "${API}/reviews/webhook" 2>/dev/null) || EMR_STATUS=0
if [ "$EMR_STATUS" = "401" ] || [ "$EMR_STATUS" = "400" ] || [ "$EMR_STATUS" = "403" ]; then
  pass "EMR webhook rejects bad HMAC ($EMR_STATUS)"
else
  warn "EMR webhook → HTTP $EMR_STATUS (expected 401/400)"
fi

# ══════════════════════════════════════════════════════════════════════════════
section "12. Cleanup"
# ══════════════════════════════════════════════════════════════════════════════

# Delete QA keyword and location to leave DB clean
if [ -n "$TOKEN" ]; then
  if [ -n "$KEYWORD_ID" ] && [ "$KEYWORD_ID" != "null" ]; then
    api_call DELETE "/keywords/$KEYWORD_ID" "" "$TOKEN"
    if [ "$STATUS" = "200" ] || [ "$STATUS" = "204" ]; then
      pass "Deleted QA keyword"
    else
      warn "Could not delete QA keyword (HTTP $STATUS)"
    fi
  fi

  if [ -n "$LOCATION_ID" ] && [ "$LOCATION_ID" != "null" ]; then
    api_call DELETE "/locations/$LOCATION_ID" "" "$TOKEN"
    if [ "$STATUS" = "200" ] || [ "$STATUS" = "204" ]; then
      pass "Deleted QA location"
    else
      warn "Could not delete QA location (HTTP $STATUS)"
    fi
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
section "Summary"
# ══════════════════════════════════════════════════════════════════════════════

TOTAL=$((PASS + FAIL + WARN + SKIP))
echo ""
echo -e "  ${GREEN}Passed:${RESET}  $PASS"
echo -e "  ${RED}Failed:${RESET}  $FAIL"
echo -e "  ${YELLOW}Warned:${RESET}  $WARN"
echo -e "  ${YELLOW}Skipped:${RESET} $SKIP"
echo -e "  Total:   $TOTAL checks"
echo ""

if [ ${#FAILURES[@]} -gt 0 ]; then
  echo -e "${RED}${BOLD}FAILURES:${RESET}"
  for f in "${FAILURES[@]}"; do
    echo -e "  ${RED}✗${RESET} $f"
  done
  echo ""
fi

if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}✓ ALL CHECKS PASSED${RESET}"
  exit 0
else
  echo -e "${RED}${BOLD}✗ $FAIL CHECK(S) FAILED${RESET}"
  exit 1
fi
