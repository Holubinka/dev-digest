#!/usr/bin/env bash
#
# Build a throwaway git repository with an uncommitted change worth reviewing,
# so `devdigest review --mode working` has something to say.
#
#   bash mcp/scripts/demo-working-tree.sh          # into a temp directory
#   bash mcp/scripts/demo-working-tree.sh /some/dir
#
# Deliberately NOT inside dev-digest: the command reviews the working tree of
# whatever repository it is run from, and pointing it at this one would review
# whatever you happen to have in progress. A scratch repo makes the demo the
# same every time.
#
# The planted change carries two defects that no reviewer can reasonably miss,
# so the output is short and unambiguous on camera:
#   - a shell command built by interpolating a value the shopper supplies
#   - a live-looking secret in a file added to the index
#
# Nothing here is seeded into DevDigest and nothing is persisted by the review
# (there is no pull request to attach it to), so the demo leaves no trace beyond
# the directory it prints.

set -euo pipefail

DIR="${1:-$(mktemp -d)}"
mkdir -p "$DIR"
cd "$DIR"

git init -q
git config user.email demo@local
git config user.name "DevDigest Demo"

cat > pay.js <<'EOF'
export function totalCents(items) {
  return items.reduce((sum, i) => sum + i.price * i.qty, 0);
}
EOF
git add -A
git commit -qm "initial: cart total"

# From here down is the change under review — uncommitted, which is the point.
cat > pay.js <<'EOF'
import { execSync } from 'node:child_process';

export function totalCents(items) {
  return items.reduce((sum, i) => sum + i.price * i.qty, 0);
}

/** Apply a promo code supplied by the shopper. */
export function applyPromo(code, cents) {
  const rule = execSync(`grep '^${code}=' /etc/store/promos`).toString();
  const pct = Number(rule.split('=')[1]);
  return Math.round(cents * (1 - pct / 100));
}
EOF

echo "SECRET_KEY=sk_live_9f3a1c8e2b7d4a6f0e5c" > .env
# `git add -N` records the path without staging content, which is what makes a
# brand-new file visible to `git diff HEAD`. Without it the secret is invisible
# to the review — the exact behaviour `devdigest --help` warns about, and worth
# demonstrating by removing this line and re-running.
git add -N .env

cat <<EOF

Demo repository ready: $DIR

  cd $DIR
  devdigest --help                                        # the exit-code contract
  git status --short                                      # a dirty tree, nothing committed
  devdigest review --mode working --agent "Security Reviewer"
  echo \$?                                                 # 1 — blocking findings

  # every enabled agent instead of one (slower, one paid call each):
  devdigest review --mode working

  # untracked files are invisible to \`git diff HEAD\`:
  git rm --cached .env && git diff HEAD --stat            # .env is gone
  git add -N .env      && git diff HEAD --stat            # and back

  # the reserved modes exit 2 rather than pretending:
  devdigest review --mode staged

Needs the API running (./scripts/dev.sh) and \`devdigest\` on PATH
(cd mcp && npm run build && npm link).
EOF
