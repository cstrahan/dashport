#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$SCRIPT_DIR/src"
DIST="$SCRIPT_DIR/dist"

# Clean
rm -rf "$DIST/chrome" "$DIST/firefox"

# Build Chrome version
mkdir -p "$DIST/chrome/icons"
cp "$SRC/background.js" "$SRC/popup.html" "$SRC/popup.js" "$DIST/chrome/"
cp "$SRC/icons/"* "$DIST/chrome/icons/"
cp "$SRC/manifest.chrome.json" "$DIST/chrome/manifest.json"

# Build Firefox version
mkdir -p "$DIST/firefox/icons"
cp "$SRC/background.js" "$SRC/popup.html" "$SRC/popup.js" "$DIST/firefox/"
cp "$SRC/icons/"* "$DIST/firefox/icons/"
cp "$SRC/manifest.firefox.json" "$DIST/firefox/manifest.json"

echo "Built:"
echo "  Chrome:  $DIST/chrome/"
echo "  Firefox: $DIST/firefox/"
