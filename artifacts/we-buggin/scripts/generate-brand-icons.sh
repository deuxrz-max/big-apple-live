#!/usr/bin/env bash
set -euo pipefail

app_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
brand_dir="$app_root/public/brand"
source_file="$brand_dir/deux-wild-logo.png"

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

make_icon() {
  local size="$1" output="$2"
  magick "$source_file" -strip -resize "${size}x${size}" -background black \
    -gravity center -extent "${size}x${size}" "$brand_dir/$output"
}

make_icon 32 deux-wild-favicon-32.png
make_icon 180 deux-wild-apple-touch-icon.png
make_icon 192 deux-wild-icon-192.png
make_icon 512 deux-wild-icon-512.png
magick "$source_file" -strip -resize '80%x80%' -background black \
  -gravity center -extent 512x512 "$brand_dir/deux-wild-icon-maskable-512.png"

echo "Generated Deux Wild favicon, Apple touch icon, and PWA icons from $source_file."
