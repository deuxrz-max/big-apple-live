#!/usr/bin/env bash
set -euo pipefail

app_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
brand_dir="$app_root/public/brand"
source_file="$brand_dir/deux-wild-logo.png"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick (magick) is required to generate the Deux Wild icon sizes." >&2
  exit 1
fi
if [[ ! -f "$source_file" ]]; then
  echo "Missing logo source: $source_file" >&2
  exit 1
fi
format="$(magick identify -format '%m' "$source_file")"
dimensions="$(magick identify -format '%wx%h' "$source_file")"
if [[ "$format" != "PNG" ]]; then
  echo "Expected a PNG logo, found $format." >&2
  exit 1
fi
if [[ "$dimensions" != "1700x1700" ]]; then
  echo "Expected a 1700x1700 logo, found $dimensions." >&2
  exit 1
fi

write_gloss_overlay() {
  local size="$1"
  local bottom=$((size * 42 / 100))
  local curve_control=$((size * 53 / 100))
  local curve_edge=$((size * 16 / 100))
  cat > "$tmpdir/gloss-${size}.svg" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="glass" x1="0" y1="0" x2="0.7" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/>
      <stop offset="0.38" stop-color="#ffffff" stop-opacity="0.075"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <path d="M0 0 H${size} V${bottom} C${size} ${curve_control} ${size} ${curve_edge} 0 $((size * 30 / 100)) Z" fill="url(#glass)"/>
  <path d="M${size} ${curve_edge} C${size} $((size * 29 / 100)) $((size * 48 / 100)) $((size * 18 / 100)) 0 $((size * 24 / 100))" fill="none" stroke="url(#rim)" stroke-width="$((size * 2 / 100))"/>
</svg>
EOF
}

make_icon() {
  local size="$1" output="$2"
  local base="$tmpdir/${output}.base.png"
  local gloss="$tmpdir/${output}.gloss.png"
  write_gloss_overlay "$size"
  magick "$source_file" -strip -resize "${size}x${size}" -background black \
    -gravity center -extent "${size}x${size}" "$base"
  magick -background none "$tmpdir/gloss-${size}.svg" -resize "${size}x${size}!" "png32:$gloss"
  magick "$base" "$gloss" -compose over -composite "$brand_dir/$output"
}

make_maskable_icon() {
  local size=512
  local base="$tmpdir/deux-wild-icon-maskable.base.png"
  local gloss="$tmpdir/deux-wild-icon-maskable.gloss.png"
  write_gloss_overlay "$size"
  magick "$source_file" -strip -resize '80%x80%' -background black \
    -gravity center -extent "${size}x${size}" "$base"
  magick -background none "$tmpdir/gloss-${size}.svg" -resize "${size}x${size}!" "png32:$gloss"
  magick "$base" "$gloss" -compose over -composite \
    "$brand_dir/deux-wild-icon-maskable-512.png"
}

make_icon 32 deux-wild-favicon-32.png
make_icon 180 deux-wild-apple-touch-icon.png
make_icon 192 deux-wild-icon-192.png
make_icon 512 deux-wild-icon-512.png
make_maskable_icon

echo "Generated Deux Wild favicon, Apple touch icon, and PWA icons from $source_file."
