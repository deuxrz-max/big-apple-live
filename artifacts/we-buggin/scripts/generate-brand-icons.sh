#!/usr/bin/env bash
set -euo pipefail

app_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
brand_dir="$app_root/public/brand"
source_file="$brand_dir/big-apple-live-approved.jpg"

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick (magick) is required to generate the Big Apple Live icon sizes." >&2
  exit 1
fi
if [[ ! -f "$source_file" ]]; then
  echo "Missing logo source: $source_file" >&2
  exit 1
fi
format="$(magick identify -format '%m' "$source_file")"
dimensions="$(magick identify -format '%wx%h' "$source_file")"
if [[ "$format" != "JPEG" ]]; then
  echo "Expected the approved JPEG logo, found $format." >&2
  exit 1
fi
if [[ "$dimensions" != "896x1200" ]]; then
  echo "Expected the approved 896x1200 logo, found $dimensions." >&2
  exit 1
fi

make_icon() {
  local size="$1" output="$2"
  magick "$source_file" -strip -resize "${size}x${size}" -background black \
    -gravity center -extent "${size}x${size}" "$brand_dir/$output"
}

make_maskable_icon() {
  local size=512
  magick "$source_file" -strip -resize '409x409' -background black \
    -gravity center -extent "${size}x${size}" "$brand_dir/deux-wild-icon-maskable-512.png"
}

make_icon 32 deux-wild-favicon-32.png
make_icon 180 deux-wild-apple-touch-icon.png
make_icon 192 deux-wild-icon-192.png
make_icon 512 deux-wild-icon-512.png
make_maskable_icon

echo "Generated app icons from the approved Big Apple Live logo without cropping or distortion."
