#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$SCRIPT_DIR/src"
DIST="$SCRIPT_DIR/dist"

# Extension name and version, used for archive filenames.
NAME="dashport"
VERSION="$(grep -m1 '"version"' "$SRC/manifest.chrome.json" \
  | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"

# Files shared by both builds (everything except the manifest).
COMMON_FILES=(background.js popup.html popup.js)

# Build one browser target into $DIST/<target> and produce a store-ready zip.
#   $1 = target name (chrome|firefox)
build_target() {
  local target="$1"
  local out="$DIST/$target"
  local zip="$DIST/$NAME-$target-$VERSION.zip"

  rm -rf "$out" "$zip"
  mkdir -p "$out/icons"

  local f
  for f in "${COMMON_FILES[@]}"; do
    cp "$SRC/$f" "$out/"
  done
  cp "$SRC/icons/"*.png "$out/icons/"
  cp "$SRC/manifest.$target.json" "$out/manifest.json"

  # Zip the contents (not the directory itself) so manifest.json sits at the
  # archive root, as required by the Chrome Web Store and Firefox Add-ons.
  ( cd "$out" && zip -r -X "$zip" . -x '*.DS_Store' >/dev/null )

  echo "  $target: $zip"
}

echo "Building $NAME $VERSION"
build_target chrome
build_target firefox
