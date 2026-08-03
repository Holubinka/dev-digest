#!/usr/bin/env bash
# Part of the import fixture: an executable the importer must NEVER read.
#
# If this text ever appears in an imported skill's body, the allowlist has been
# replaced by a denylist somewhere and the skipped-entries list is lying.
set -euo pipefail

echo "IMPORTER-MUST-NOT-READ-THIS"
grep -rn "sleep(" "${1:-.}" || true
