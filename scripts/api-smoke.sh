#!/usr/bin/env bash
# ============================================================
# SuperLocalSEO — API Plan-Gating Smoke Test
# ============================================================
# Fast, headless (no browser) verification of the behaviour behind the
# Lite/Pro/Admin UI: authentication, the plan-gating matrix, admin
# protection, key data invariants, and public-page/security checks.
#
# Complements scripts/qa.sh (which exercises a throwaway account end to
# end). This one drives the three real tiered accounts and asserts that
# Lite is blocked from Pro features, Pro is allowed, and admin data is
# protected — the security-critical core of the Lite/Pro split.
#
# Usage:
#   bash scripts/api-smoke.sh                              # localhost:3000
#   BASE_URL=https://superlocalseo.com bash scripts/api-smoke.sh
#   BASE_URL=https://superlocalseo.com \
#     LITE_EMAIL=... LITE_PASSWORD=... \
#     PRO_EMAIL=...  PRO_PASSWORD=... \
#     ADMIN_EMAIL=... ADMIN_PASSWORD=... bash scripts/api-smoke.sh
#
# Requirements: curl, jq
# Exit code: 0 = all pass, 1 = any failures
# ============================================================

set -uo pipefail

BASE="${BASE_URL:-http://localhost:3000}"
API="${BASE}/api"

# Test-mode accounts. Override via env for other environments.
LITE_EMAIL="${LITE_EMAIL:-info@nerdbox.com}";        LITE_PASSWORD="${LITE_PASSWORD:-LiteTest2026!}"
PRO_EMAIL="${PRO_EMAIL:-brent@nerdbox.com}";          PRO_PASSWORD="${PRO_PASSWORD:-ProTest2026!}"
ADMIN_EMAIL="${ADMIN_EMAIL:-hello@superlocalseo.com}"; ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin#Test2026!}"

pass=0; fail=0; FAILS=""

login() { # email password -> echo accessToken (empty on failure)
  curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | jq -r '.data.accessToken // empty' 2>/dev/null
}

code() { # token method path -> http_code  (empty token = no auth header)
  local t="$1" m="$2" p="$3"; local -a H=()
  [ -n "$t" ] && H=(-H "Authorization: Bearer $t")
  curl -s -o /dev/null -w "%{http_code}" -X "$m" "${H[@]}" "$API$p"
}

json() { # token path jq-filter -> value
  local t="$1" p="$2" f="$3"; local -a H=()
  [ -n "$t" ] && H=(-H "Authorization: Bearer $t")
  curl -s "${H[@]}" "$API$p" | jq -r "$f" 2>/dev/null
}

chk() { # label expected actual
  if [ "$2" = "$3" ]; then pass=$((pass+1)); printf "  PASS  %-52s [%s]\n" "$1" "$3"
  else fail=$((fail+1)); FAILS="${FAILS}\n  - $1 (expected '$2', got '$3')"; printf "  FAIL  %-52s [got %s, want %s]\n" "$1" "$3" "$2"; fi
}

echo "=== SuperLocalSEO API smoke test → ${BASE} ==="
echo
echo "### Authentication ###"
LT="$(login "$LITE_EMAIL" "$LITE_PASSWORD")"
PT="$(login "$PRO_EMAIL" "$PRO_PASSWORD")"
AT="$(login "$ADMIN_EMAIL" "$ADMIN_PASSWORD")"
chk "Lite login"                  "200" "$([ -n "$LT" ] && echo 200 || echo ERR)"
chk "Pro login"                   "200" "$([ -n "$PT" ] && echo 200 || echo ERR)"
chk "Admin login"                 "200" "$([ -n "$AT" ] && echo 200 || echo ERR)"
chk "Bad password -> 401"         "401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$LITE_EMAIL\",\"password\":\"__wrong__\"}")"
chk "Unauthenticated /clients -> 401" "401" "$(code "" GET /clients)"

if [ -z "$LT" ] || [ -z "$PT" ] || [ -z "$AT" ]; then
  echo; echo "!! Could not obtain all tokens — aborting remaining checks."; echo "TOTAL: $pass passed, $fail failed"; exit 1
fi

echo; echo "### Open endpoints (Lite + Pro both 200) ###"
for ep in /clients /metrics /rankings /reviews /integrations /billing/status /competitors /analytics/reviews/trend; do
  chk "Lite GET $ep" "200" "$(code "$LT" GET "$ep")"
  chk "Pro  GET $ep" "200" "$(code "$PT" GET "$ep")"
done

echo; echo "### Pro-only gating (Lite 403 / Pro 200) ###"
for ep in /citations /audits/bl /team /qr /analytics/roi "/analytics/export?type=rankings" /competitors/gap; do
  chk "Lite GET $ep -> 403" "403" "$(code "$LT" GET "$ep")"
  chk "Pro  GET $ep -> 200" "200" "$(code "$PT" GET "$ep")"
done

echo; echo "### Admin-only gating (Lite/Pro 403 / Admin 200) ###"
chk "Lite  GET /admin/overview -> 403" "403" "$(code "$LT" GET /admin/overview)"
chk "Pro   GET /admin/overview -> 403" "403" "$(code "$PT" GET /admin/overview)"
chk "Admin GET /admin/overview -> 200" "200" "$(code "$AT" GET /admin/overview)"

echo; echo "### Data invariants ###"
chk "Lite productLine == lite"          "lite"     "$(json "$LT" /clients '.data.productLine')"
chk "Pro  productLine == pro"           "pro"      "$(json "$PT" /clients '.data.productLine')"
chk "Lite billing status == active"     "active"   "$(json "$LT" /billing/status '.data.status')"
chk "Pro  billing status == trialing"   "trialing" "$(json "$PT" /billing/status '.data.status')"

echo; echo "### Public pages / security (no auth) ###"
for path in / /login /register /privacy /terms /dashboard; do
  chk "GET $path -> 200" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE$path")"
done
if curl -s "$BASE/src/main.tsx" | grep -qi 'id="root"\|<!doctype'; then
  chk "/src/main.tsx served as SPA (raw source not exposed)" "ok" "ok"
else
  chk "/src/main.tsx not raw source" "ok" "EXPOSED"
fi

echo
echo "======================================================"
echo "TOTAL: $pass passed, $fail failed"
if [ "$fail" -gt 0 ]; then printf "FAILURES:%b\n" "$FAILS"; exit 1; fi
exit 0
