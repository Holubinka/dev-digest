#!/usr/bin/env bash
#
# Gathers the raw data a dependency check needs, for one or more packages: declared
# dependencies and devDependencies (with the resolved installed version and on-disk size
# when node_modules is present), whether each dependency is actually imported anywhere
# under that package's own source, the package's tsconfig path aliases (the real internal
# cross-package edges in this no-workspace repo), and version drift for any dependency name
# that appears in more than one package. Pure function over the working tree — no network,
# no model — prints one JSON object and always exits 0.
#
#   bash scripts/dependency-checker/collect.sh [package ...]
#
# With no arguments, covers all five packages (client, server, reviewer-core, e2e, mcp).
# Pass one or more names to narrow scope, e.g.:
#   bash scripts/dependency-checker/collect.sh server client
#
# Each enriched entry is built and appended as one compact JSON line to a scratch file, then
# combined with `jq --slurpfile` — not accumulated by re-parsing a growing JSON string on
# every iteration, which is the fragile way to do this in a loop.
#
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

ALL_PACKAGES="server client reviewer-core e2e mcp"
PACKAGES="${*:-$ALL_PACKAGES}"

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

manager_for() { # package dir -> pnpm|npm|unknown
  if [ -f "$1/pnpm-lock.yaml" ]; then printf 'pnpm'
  elif [ -f "$1/package-lock.json" ]; then printf 'npm'
  else printf 'unknown'
  fi
}

size_of() { # node_modules/<dep> path -> human size, or empty if not installed
  [ -d "$1" ] || return 0
  du -sh "$1" 2>/dev/null | cut -f1
}

installed_version_of() { # node_modules/<dep> path -> version, or empty if not installed
  local pj="$1/package.json"
  [ -f "$pj" ] || return 0
  jq -r '.version // empty' "$pj" 2>/dev/null || true
}

# Is $2 (a bare or scoped package name) imported anywhere under $1's own source? Matches
# `from "name"`, `from "name/sub-path"`, `require("name")` — not a match on the package's
# own package.json, which always "contains" its own name.
is_imported() { # package_dir dep_name -> "yes" or empty
  local dir="$1" dep="$2" src="$1/src"
  [ -d "$src" ] || src="$dir"
  local esc
  esc="$(printf '%s' "$dep" | sed 's/[.[\*^$]/\\&/g')"
  # `require(`/`import(` go straight to a quote; ES `from` and a side-effect-only
  # `import 'x'` always have a space first — `[( ]*` covers all four without hardcoding
  # any one shape. Static `import x from 'dep'`, dynamic `import('dep')`, side-effect
  # `import 'dep/config'` and `require('dep')` are the four import shapes this repo uses.
  if grep -RIlE "(from|require|import)[( ]*[\"']${esc}(/|[\"'])" "$src" \
       --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.cjs' \
       --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next \
       >/dev/null 2>&1; then
    printf 'yes'
  fi
}

# Appends one compact JSON line to stdout. $4 is "true"/"false": whether to check import
# usage (skipped for devDependencies — a build/test tool is not expected to be `import`ed
# from application source, so the check would just be noise).
enrich() { # package_dir name range check_usage
  local dir="$1" name="$2" range="$3" check_usage="$4"
  local nm_path="$dir/node_modules/$name"
  local version size used_json
  version="$(installed_version_of "$nm_path")"
  size="$(size_of "$nm_path")"
  used_json="null"
  if [ "$check_usage" = "true" ]; then
    if [ -n "$(is_imported "$dir" "$name")" ]; then used_json="true"; else used_json="false"; fi
  fi
  jq -nc --arg name "$name" --arg range "$range" --arg version "$version" --arg size "$size" \
    --argjson used "$used_json" \
    '{name:$name, range:$range,
      installedVersion:(if $version=="" then null else $version end),
      sizeOnDisk:(if $size=="" then null else $size end),
      imported:$used}'
}

package_report() { # package_dir -> JSON object, printed to stdout
  local dir="$1"
  local manager tsPaths
  manager="$(manager_for "$dir")"
  tsPaths="{}"
  [ -f "$dir/tsconfig.json" ] && tsPaths="$(jq -c '.compilerOptions.paths // {}' "$dir/tsconfig.json" 2>/dev/null || echo '{}')"

  local deps_file="$SCRATCH/$(basename "$dir").deps.jsonl"
  local devdeps_file="$SCRATCH/$(basename "$dir").devdeps.jsonl"
  : > "$deps_file"
  : > "$devdeps_file"

  while IFS=$'\t' read -r name range; do
    [ -z "$name" ] && continue
    enrich "$dir" "$name" "$range" true >> "$deps_file"
  done < <(jq -r '(.dependencies // {}) | to_entries[] | "\(.key)\t\(.value)"' "$dir/package.json")

  while IFS=$'\t' read -r name range; do
    [ -z "$name" ] && continue
    enrich "$dir" "$name" "$range" false >> "$devdeps_file"
  done < <(jq -r '(.devDependencies // {}) | to_entries[] | "\(.key)\t\(.value)"' "$dir/package.json")

  jq -n --arg name "$(basename "$dir")" --arg manager "$manager" \
    --slurpfile deps "$deps_file" --slurpfile devDeps "$devdeps_file" --argjson paths "$tsPaths" \
    '{name:$name, manager:$manager, dependencies:$deps, devDependencies:$devDeps, tsconfigPaths:$paths}'
}

reports_file="$SCRATCH/packages.jsonl"
: > "$reports_file"
for p in $PACKAGES; do
  [ -d "$p" ] || continue
  [ -f "$p/package.json" ] || continue
  package_report "$p" >> "$reports_file"
done

# Version drift: any runtime dependency name declared by more than one package, resolved to
# more than one distinct version across them (installed version preferred, declared range as
# fallback when nothing is installed). devDependencies are excluded — a shared runtime
# version mismatch (e.g. two `zod`s validating the same wire contract) is the one that bites;
# a shared build-tool version rarely does.
jq -n --slurpfile packages "$reports_file" '
  {
    packages: $packages,
    versionDrift: (
      [$packages[] as $pkg | $pkg.dependencies[] | {package: $pkg.name, name, version: (.installedVersion // .range)}]
      | group_by(.name)
      | map(select(length > 1))
      | map(select([.[].version] | unique | length > 1))
      | map({name: .[0].name, resolved: (map({(.package): .version}) | add)})
    )
  }
'
