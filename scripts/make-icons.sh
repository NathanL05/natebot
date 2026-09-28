#!/bin/sh
# Regenerates every app icon from one source image.
#   npm run icons                     # uses build/icon.svg
#   npm run icons -- path/to/art.png  # or any 1024x1024 PNG / SVG
# SVG sources need rsvg-convert (brew install librsvg); PNG uses built-in sips.
set -e
cd "$(dirname "$0")/.."
SRC="${1:-build/icon.svg}"
SET="$(mktemp -d)/NateBot.iconset"
mkdir -p "$SET"

render() { # size out
  case "$SRC" in
    *.svg) rsvg-convert -w "$1" -h "$1" "$SRC" -o "$2" ;;
    *) sips -z "$1" "$1" "$SRC" --out "$2" >/dev/null ;;
  esac
}

for s in 16 32 128 256 512; do
  render "$s" "$SET/icon_${s}x${s}.png"
  render "$((s * 2))" "$SET/icon_${s}x${s}@2x.png"
done
render 1024 build/icon.png
cp build/icon.png resources/icon.png
iconutil -c icns "$SET" -o build/icon.icns
rm -rf "$(dirname "$SET")"

# Menu-bar icon (monochrome template, drawn separately).
if command -v rsvg-convert >/dev/null; then
  rsvg-convert -w 18 -h 18 build/trayTemplate.svg -o resources/trayTemplate.png
  rsvg-convert -w 36 -h 36 build/trayTemplate.svg -o resources/trayTemplate@2x.png
fi

# Re-brand the dev Electron so `npm run dev` shows the new icon too.
node scripts/brand-dev-electron.mjs
echo "Icons updated from $SRC"
