#!/usr/bin/env bash
#
# Everything `devdigest review --mode working` needs, checked before the camera
# is on rather than after.
#
#   bash mcp/scripts/demo-preflight.sh
#
# Read-only and free: it starts nothing, changes no setting and spends no model
# call. Each check prints what to run when it fails, so a red line is actionable
# on its own.
#
# Exit 0 when the demo can be recorded, 1 when something would break it.

set -uo pipefail

API="${DEVDIGEST_API_URL:-http://localhost:3001}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FAIL=0

ok()   { printf '  \033[32mok\033[0m    %s\n' "$1"; }
warn() { printf '  \033[33mwarn\033[0m  %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; printf '        → %s\n' "$2"; FAIL=1; }

echo "devdigest demo preflight"
echo

# 1. The command itself. `npm link` is per Node version, so switching versions
#    with nvm silently takes it off PATH — the most likely surprise here.
if BIN="$(command -v devdigest 2>/dev/null)"; then
  ok "devdigest on PATH ($BIN)"
else
  bad "devdigest is not on PATH" "cd '$ROOT/mcp' && npm run build && npm link"
fi

# 2. The build behind it. A stale dist reviews with yesterday's code and nothing
#    says so, because the symlink keeps working.
DIST="$ROOT/mcp/dist/cli.js"
if [ -f "$DIST" ]; then
  NEWER="$(find "$ROOT/mcp/src" -name '*.ts' -newer "$DIST" 2>/dev/null | head -3)"
  if [ -n "$NEWER" ]; then
    warn "mcp/dist is older than these sources — the demo would run stale code:"
    printf '        %s\n' $NEWER
    printf '        → cd %s/mcp && npm run build\n' "$ROOT"
  else
    ok "mcp/dist/cli.js is newer than every source"
  fi
else
  bad "mcp/dist/cli.js is missing" "cd '$ROOT/mcp' && npm run build"
fi

# 3. The API. Everything the CLI does after `git diff` goes through it.
CODE="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$API/health" 2>/dev/null)"
if [ "$CODE" = "200" ]; then
  ok "API answering at $API"
else
  bad "API at $API answered '$CODE', not 200" "./scripts/dev.sh  (leave it running in its own tab)"
fi

# 4. Who would review, and how long that takes. This is the difference between a
#    26-second take and a 110-second one, measured — not guessed.
if [ "$CODE" = "200" ]; then
  AGENTS="$(curl -s -m 5 "$API/agents" 2>/dev/null)"
  ENABLED="$(printf '%s' "$AGENTS" | python3 -c 'import json,sys;print(sum(1 for a in json.load(sys.stdin) if a.get("enabled")))' 2>/dev/null)"
  if [ -z "$ENABLED" ]; then
    bad "could not read $API/agents" "check the API log where ./scripts/dev.sh runs"
  elif [ "$ENABLED" = "0" ]; then
    bad "no agent is enabled — the review would refuse with 409" "enable one in the Agents screen"
  else
    printf '%s' "$AGENTS" | python3 -c '
import json, sys
for a in json.load(sys.stdin):
    if a.get("enabled"):
        print("          " + a["name"])'
    if [ "$ENABLED" = "1" ]; then
      ok "$ENABLED agent enabled — one paid call per run"
    else
      warn "$ENABLED agents enabled: without --agent every one of them reviews,"
      printf '        one after another. Five over a small diff measured 110s.\n'
      printf '        → devdigest review --mode working --agent "<one name above>"\n'
    fi
  fi
fi

# 5. A provider key, since every agent above spends one call.
SECRETS="$HOME/.devdigest/secrets.json"
if [ -f "$SECRETS" ]; then
  KEYS="$(python3 -c "import json;print(' '.join(sorted(json.load(open('$SECRETS')))))" 2>/dev/null)"
  case "$KEYS" in
    *API_KEY*) ok "provider key present ($KEYS)" ;;
    *)         bad "no provider key in $SECRETS (found: ${KEYS:-none})" "add one in Settings → Secrets" ;;
  esac
else
  bad "$SECRETS is missing" "add a provider key in Settings → Secrets"
fi

echo
if [ "$FAIL" = "0" ]; then
  echo "Ready. Build a tree to review with:"
  echo "  bash mcp/scripts/demo-working-tree.sh"
else
  echo "Not ready — fix the FAIL lines above and re-run."
fi
exit "$FAIL"
