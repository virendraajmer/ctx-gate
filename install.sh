#!/usr/bin/env bash
# Installs ctx-gate and runs `ctx-gate init` in the current repo.
#
# NOTE: this script is written best-effort and has not been executed on
# real Linux/macOS (this repo was built on Windows). Verify via WSL2 or
# CI (ubuntu-latest) before relying on it in production.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

VERSION_FILE="$SCRIPT_DIR/VERSION"
if [[ ! -f "$VERSION_FILE" ]]; then
  echo "Could not find VERSION next to install.sh at $SCRIPT_DIR" >&2
  exit 1
fi
VERSION="$(tr -d '[:space:]' < "$VERSION_FILE")"

INSTALL_ROOT="$HOME/.ctx-gate"
VERSION_DIR="$INSTALL_ROOT/$VERSION"

echo "Installing ctx-gate $VERSION to $VERSION_DIR ..."
mkdir -p "$VERSION_DIR"

for item in bin src package.json; do
  if [[ -e "$SCRIPT_DIR/$item" ]]; then
    cp -R "$SCRIPT_DIR/$item" "$VERSION_DIR/"
  fi
done

if [[ -d "$SCRIPT_DIR/node_modules" ]]; then
  cp -R "$SCRIPT_DIR/node_modules" "$VERSION_DIR/"
else
  echo "warning: node_modules not found next to install.sh — run 'npm install --omit=dev' inside $VERSION_DIR before using ctx-gate." >&2
fi

chmod +x "$VERSION_DIR/bin/ctx-gate.js" 2>/dev/null || true

# Unprivileged on Linux/macOS, unlike install.ps1's Windows pointer file.
ln -sfn "$VERSION_DIR" "$INSTALL_ROOT/current"

TARGET_REPO="$(pwd)"
echo "Running 'ctx-gate init' in $TARGET_REPO ..."
node "$VERSION_DIR/bin/ctx-gate.js" init

mkdir -p "$TARGET_REPO/.github/hooks"
cp "$SCRIPT_DIR/hook-templates/hooks.json" "$TARGET_REPO/.github/hooks/ctx-gate.json"

echo "ctx-gate $VERSION installed. Hook config written to $TARGET_REPO/.github/hooks/ctx-gate.json"
echo "NOTE: this script has not been executed on real Linux/macOS (built on Windows) — verify via WSL2 or CI (ubuntu-latest) before relying on it in production."
