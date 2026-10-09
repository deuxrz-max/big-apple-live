#!/usr/bin/env bash
# Regenerate serving copies from the untouched uploads, never from lossy copies.
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
sources=(
  "grok_video_2026-09-04-11-49-45_1791486375400.mp4"
  "video_1788023530265_1791486446786.mp4"
  "Project_08-20(1)_Full_HD_1080p_MEDIUM_FR30_1791486473729.mp4"
  "Project_08-29_Full_HD_1080p_MEDIUM_FR30_1791486565694.mp4"
)
targets=(
  "01-immortal-studios.mp4"
  "02-moonlit-characters.mp4"
  "03-red-tunnel.mp4"
  "04-additional-project.mp4"
)
output="$root/artifacts/we-buggin/public/promo-videos"
temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT
for i in "${!sources[@]}"; do
  source="$root/attached_assets/${sources[$i]}"
  test -f "$source"
  fps="$(ffprobe -v error -select_streams V:0 -show_entries stream=r_frame_rate -of csv=p=0 "$source")"
  gop="$(awk -v fps="$fps" 'BEGIN { split(fps, f, "/"); printf "%d", 2*f[1]/f[2] }')"
  # Keep aspect ratio and every frame; no upscaling, trimming or audio conversion.
  # AAC is already present in all four uploads: stream-copy preserves sound exactly.
  ffmpeg -hide_banner -loglevel warning -nostdin -y -i "$source" \
    -map 0:V:0 -map 0:a:0 -map_metadata -1 \
    -vf "scale=w='min(540,iw)':h='min(960,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2" \
    -c:v libx264 -preset slow -crf 26 -maxrate 1000k -bufsize 2000k \
    -profile:v high -pix_fmt yuv420p -g "$gop" -fps_mode passthrough \
    -c:a copy -movflags +faststart "$temp/${targets[$i]}"
  ffmpeg -hide_banner -loglevel error -xerror -i "$temp/${targets[$i]}" -f null -
done
# Only replace public copies after all four have successfully encoded and decoded.
for target in "${targets[@]}"; do
  cp "$temp/$target" "$output/$target"
done
