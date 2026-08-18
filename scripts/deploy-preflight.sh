#!/usr/bin/env bash
#
# Deploy preflight — checks this repo against the two host traps that took n8n
# down for ~6 minutes on 2026-08-16 (issue #165).
#
# WHY A SCRIPT AND NOT A DOC
# --------------------------
# Both traps were already documented in /root/CLAUDE.md when they fired, and the
# documentation did not prevent them. They are silent by construction: the
# wrong config loads, the container starts, and nothing reports an error. The
# only reliable defence is a check that runs every time.
#
# This repo is currently safe from BOTH, and the point of this script is to keep
# it that way. Neither compose file uses ${} interpolation, and neither has a
# bind mount of any kind. Those are properties someone can remove in one line
# while cleaning up, so they are asserted here and in CI.
#
# Usage:
#   scripts/deploy-preflight.sh            # static checks (no Docker needed)
#   scripts/deploy-preflight.sh --runtime  # also compare inodes of live mounts
#
# Exit non-zero on any failure. Intended to gate deploys and to run in CI.

set -euo pipefail
cd "$(dirname "$0")/.."

RUNTIME=0
[[ "${1:-}" == "--runtime" ]] && RUNTIME=1

COMPOSE_FILES=(docker-compose.yml docker-compose.test.yml)
fail=0
pass() { printf '  \033[32mok\033[0m   %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=1; }
note() { printf '       %s\n' "$1"; }

echo "Deploy preflight (#165)"
echo

# ── Trap 1: shell variables override .env during compose interpolation ────────
#
# Compose resolves ${VAR} from the SHELL first, falling back to .env. The root
# shell on this host exports a stale POSTGRES_PASSWORD, which is what silently
# replaced n8n's database password on recreate. A container can then survive for
# days on already-established pooled connections, so the breakage surfaces long
# after the deploy that caused it — which is why it looked unrelated.
echo "Trap 1 — \${} interpolation in compose files"
interp=0
for f in "${COMPOSE_FILES[@]}"; do
  [[ -f "$f" ]] || continue
  if hits=$(grep -nE '\$\{[A-Za-z_][A-Za-z0-9_]*' "$f"); then
    interp=1
    bad "$f uses \${} interpolation:"
    echo "$hits" | sed 's/^/         /'
  fi
done
if [[ $interp -eq 0 ]]; then
  pass "no \${} interpolation — shell variables cannot reach compose"
else
  note "Every interpolated var must be passed with 'env -u VAR' or verified with:"
  note "  docker compose config | grep VAR"
  note "See /root/CLAUDE.md standing trap 3."
fi

# ── Trap 2: single-file bind mounts are pinned to the inode ───────────────────
#
# Docker binds a mounted FILE by inode. Editors that write-and-rename change the
# inode, so the container keeps serving the original — and `nginx -s reload`
# re-reads the OLD file and reports success. /root/n8n/nginx/nginx.conf drifted
# this way for two and a half months.
echo
echo "Trap 2 — single-file bind mounts"
found_file_mount=0
for f in "${COMPOSE_FILES[@]}"; do
  [[ -f "$f" ]] || continue
  # Bind mounts are the ones starting with . or / — named volumes are not.
  while read -r src; do
    [[ -z "$src" ]] && continue
    if [[ -f "$src" ]]; then
      found_file_mount=1
      bad "$f mounts a FILE (inode-pinned): $src"
    fi
  done < <(grep -oE '^\s+- (\.{1,2}/[^:]+|/[^:]+):' "$f" | sed -E 's/^\s+- //; s/:$//' || true)
done
if [[ $found_file_mount -eq 0 ]]; then
  pass "no single-file bind mounts"
else
  note "A config change needs 'up -d --force-recreate --no-deps <svc>', NOT a reload."
  note "Verify with: stat -c %i <host file> vs docker exec <ctr> stat -c %i <path>"
fi

# ── Deploy hygiene the outage also depended on ────────────────────────────────
echo
echo "Deploy hygiene"
if grep -qE '^\s+env_file:' docker-compose.yml; then
  pass "api config arrives via env_file (not subject to shell override)"
else
  bad "docker-compose.yml has no env_file — check how config reaches the container"
fi

# ── Runtime checks ────────────────────────────────────────────────────────────
if [[ $RUNTIME -eq 1 ]]; then
  echo
  echo "Runtime — live containers"
  if ! command -v docker >/dev/null; then
    bad "docker not available; cannot run runtime checks"
  else
    # Any file mount that IS live gets an inode comparison. Silent drift is the
    # entire failure mode, so equality is asserted rather than assumed.
    for ctr in superlocalseo-api superlocalseo-web; do
      if ! docker ps --format '{{.Names}}' | grep -qx "$ctr"; then
        note "$ctr not running — skipped"
        continue
      fi
      mounts=$(docker inspect "$ctr" --format '{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}}:{{.Destination}}{{"\n"}}{{end}}{{end}}')
      if [[ -z "$mounts" ]]; then
        pass "$ctr has no bind mounts"
        continue
      fi
      while IFS=: read -r host cpath; do
        [[ -z "$host" ]] && continue
        if [[ -f "$host" ]]; then
          hi=$(stat -c %i "$host")
          ci=$(docker exec "$ctr" stat -c %i "$cpath" 2>/dev/null || echo "?")
          if [[ "$hi" == "$ci" ]]; then
            pass "$ctr $cpath inode matches host ($hi)"
          else
            bad "$ctr $cpath inode $ci != host $hi — container is serving a STALE file"
            note "Fix: docker compose up -d --force-recreate --no-deps <service>"
          fi
        fi
      done <<< "$mounts"
    done
  fi
fi

echo
if [[ $fail -eq 0 ]]; then
  echo "PASS — safe to deploy"
else
  echo "FAIL — do not deploy until the above is resolved"
fi
exit $fail
