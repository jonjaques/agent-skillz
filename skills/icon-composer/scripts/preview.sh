#!/usr/bin/env bash
# preview.sh: render a .icon into contact sheets an agent can actually look at.
#
#   ./preview.sh <bundle.icon> [outdir] [platform]
#
# Produces, in outdir (default $TMPDIR/icon-preview):
#   sheet-appearance.png  Default | Dark | TintedDark | ClearDark, side by side
#   sheet-small.png       80px and 40px, nearest-neighbour upscaled
#   sheet-generation.png  design generation 27 | 26 (how older OS releases show it)
#   plus the individual PNGs
#
# Read the sheets. Rendering without looking is not verification: every
# structural mistake in this format (inverted group order, a background layer
# swallowing the icon, glass melting line art) is invisible in the JSON and
# obvious in the render.
#
# ImageMagick is optional: without it you get the individual PNGs and read those.

set -euo pipefail

BUNDLE="${1:?usage: preview.sh <bundle.icon> [outdir] [platform]}"
OUT="${2:-${TMPDIR:-/tmp}/icon-preview}"
PLATFORM="${3:-iOS}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ICTOOL="$(node "$HERE/iconkit.mjs" ictool)"

[ -f "$BUNDLE/icon.json" ] || { echo "no icon.json in $BUNDLE" >&2; exit 2; }
mkdir -p "$OUT"
rm -f "$OUT"/*.png

shot () { # rendition, size, outfile, extra args...
  local rendition="$1" size="$2" file="$3"; shift 3
  local msg
  if ! msg="$("$ICTOOL" "$BUNDLE" --export-image --output-file "$OUT/$file" \
      --platform "$PLATFORM" --rendition "$rendition" \
      --width "$size" --height "$size" --scale 1 "$@" 2>&1)"; then
    echo "render failed: $rendition @ ${size}px: $(echo "$msg" | tr -d '\n')" >&2
    return 1
  fi
}

shot Default    380 default.png
shot Dark       380 dark.png
shot TintedDark 380 tinted.png --tint-color 0.55 --tint-strength 0.8
shot ClearDark  380 clear.png
shot Default    380 gen26.png --design-generation 26
shot Default     80 w80.png
shot Default     40 w40.png

if command -v magick >/dev/null 2>&1; then
  # -alpha remove over a mid grey: the rounded-corner mask leaves transparent
  # corners that otherwise read as white and flatter the contrast.
  magick "$OUT/default.png" "$OUT/dark.png" "$OUT/tinted.png" "$OUT/clear.png" \
    -background '#6E6E6E' -alpha remove -alpha off +append "$OUT/sheet-appearance.png"
  magick "$OUT/default.png" "$OUT/gen26.png" \
    -background '#6E6E6E' -alpha remove -alpha off +append "$OUT/sheet-generation.png"
  # Nearest-neighbour so small sizes show their real pixels rather than a
  # resampler's opinion of them.
  magick "$OUT/w80.png" -filter point -resize 475% "$OUT/s80.png"
  magick "$OUT/w40.png" -filter point -resize 950% "$OUT/s40.png"
  magick "$OUT/s80.png" "$OUT/s40.png" -resize 300x300 \
    -background '#6E6E6E' -alpha remove -alpha off +append "$OUT/sheet-small.png"
  rm -f "$OUT/s80.png" "$OUT/s40.png"
  echo "$OUT/sheet-appearance.png"
  echo "$OUT/sheet-small.png"
  echo "$OUT/sheet-generation.png"
else
  echo "(ImageMagick not found: read the individual PNGs)"
  ls -1 "$OUT"/*.png
fi
