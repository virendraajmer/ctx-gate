#!/usr/bin/env bash
# Installs ctx-gate and runs `ctx-gate init` in the current repo.
#
# Stub — full implementation lands in Phase 8 of the build plan.
# Planned steps:
#   1. Read VERSION from this repo (pinned, not main).
#   2. Copy bin/ + src/ to ~/.ctx-gate/<version>/, symlink ~/.ctx-gate/current.
#   3. Run `ctx-gate init` in the invoking directory.
#   4. Copy hook-templates/hooks.json into the target repo's
#      .github/hooks/ctx-gate.json with the installed path substituted.
#
# NOTE: this script is written best-effort and has not been executed on
# real Linux/macOS (this repo was built on Windows). Verify via WSL2 or
# CI (ubuntu-latest) before relying on it in production.

set -euo pipefail

echo "install.sh is not implemented yet (Phase 8 of the build plan)." >&2
exit 1
