# Promo video optimization verification

Measured in development on October 8, 2026, with owner approval to replace
serving copies only. Nothing was published.

## Serving copies

Decimal MB (1 MB = 1,000,000 bytes):

| File | Original bytes | Serving bytes | Savings | Resolution | Duration (seconds) | Video frames |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| 01-immortal-studios.mp4 | 2,025,734 | 598,622 | 70.45% | 400×736 | 6.041667 | 145 |
| 02-moonlit-characters.mp4 | 3,752,244 | 727,874 | 80.60% | 540×720 | 5.061995 | 121 |
| 03-red-tunnel.mp4 | 17,819,312 | 1,480,174 | 91.69% | 540×960 | 12.181333 | 363 |
| 04-additional-project.mp4 | 80,477,161 | 6,260,455 | 92.22% | 540×960 | 53.461333 | 1,602 |
| **Total** | **104,074,451** | **9,067,125** | **91.29%** | | | |

Savings: **95,007,326 bytes**. The largest clip is now **6.26 MB**, down from
**80.48 MB**.

- H.264 High profile, yuv420p, original frame rates (24/30 fps), no upscaling.
- Aspect ratio retained, with even-pixel rounding. No cropping, trimming,
  speed changes, frame removal, baked-in tint or soundtrack replacement.
- CRF 26, 1 Mbps maximum video rate with a 2 Mbps buffer. This is a VBV
  rate-control target, not an instantaneous peak guarantee; short clips can
  average slightly over 1 Mbps. Two-second maximum keyframe interval.
- Existing AAC audio is stream-copied. Compressed audio packet SHA-256 hashes
  match each original exactly. Audio content is not re-encoded.
- Every original video frame is retained, with identical video stream durations.
  Audio/container durations match within 0.001 seconds. The second clip's
  container reports 5.061995 instead of 5.061950 seconds (0.045 ms mux rounding);
  its video duration is unchanged at 5.041667 seconds, and its audio packets match.
- All originals in `attached_assets/` passed before/after whole-file SHA-256
  checks. The public filenames and ordered playlist are unchanged.
- All four serving files passed full audio/video decoding with FFmpeg's
  `-xerror`, not just a header/first-frame probe.
- All four MP4s have top-level atoms `ftyp, moov, free, mdat`, confirming faststart.

## Partial downloads

Through the development HTTPS preview proxy, every public MP4 returned:

- HTTP **206 Partial Content** for `Range: bytes=0-1023`.
- `Accept-Ranges: bytes`, `Content-Type: video/mp4`.
- Exactly 1,024 response bytes and the correct total in `Content-Range`:
  598622, 727874, 1480174 and 6260455 bytes, respectively.

This verifies development serving, not a published host or CDN.

## Throttled browser playback

Workspace Chromium through the development HTTPS proxy, 390×844 viewport,
fresh browser contexts, cache disabled, **1.6 Mbps download / 750 kbps upload /
150 ms latency**, using Chrome network emulation. H.264/AAC codec support
reported `probably`.

The actual `PromoBackground` React component was mounted in an isolated
measurement page without account data, room API traffic or mocked media.
This is a mobile-sized browser measurement, not a physical-phone test or a
signed-in room end-to-end test.

| Optimized clip | Loadstart → playing | Buffer available when playing began | Mid-clip waiting/stall events |
| --- | ---: | ---: | ---: |
| 01 | 638 ms | 0.968 s | 0 |
| 02 | 509 ms | 0.469 s | 0 |
| 03 | 501 ms | 0.555 s | 0 |
| 04 | 665 ms | 0.858 s | 0 |

The complete playlist ended naturally in order 01 → 02 → 03 → 04 and started
01 again. Total time to the fourth clip ending was 79.378 seconds, including
initial loads and transitions. No playback errors or unavailable fallback.
Displayed-frame callbacks confirmed moving frames for all four files:
184, 121, 363 and 1,600 respectively (01 includes the beginning of its next loop).
Displayed callbacks can differ from encoded frame counts; full decoding and
FFprobe verify all 1,602 encoded frames in clip 04.

The computed background pseudo-element remained `rgba(0, 0, 0, 0.4)`.
The same video element began muted; a user-gesture sound check unmuted it,
with playback active and nonzero decoded AAC bytes. No player source changes
were made, so existing opt-in sound and reduced-motion behavior remain intact.

### Original largest clip comparison

The untouched original fourth upload was loaded separately through the same
preview server with the same network throttle and cache settings:

- Initial playback: 681 ms after loadstart.
- Buffering began at 1.960 seconds of media time.
- Three mid-playback waits during a 35-second observation.
- Only 3.968 seconds of media progress after 35 seconds elapsed.
- First two completed buffering waits: 11.729 and 8.008 seconds; the third
  was still waiting when the observation ended.

The main measured improvement is sustained playback, not a large reduction
in startup time for this already-range-capable original.

## Reproduction

From the workspace root:

```sh
bash artifacts/we-buggin/scripts/optimize-promo-videos.sh
PROMO_PREVIEW_URL="https://$REPLIT_DEV_DOMAIN" \
  node artifacts/we-buggin/scripts/measure-promo-playback.mjs
pnpm --filter @workspace/we-buggin test:playlist
```

The measurement script requires the workspace's existing Playwright installation
and `/repl/tools/bin/chromium`. It emits timestamped media events and frame/audio
observations. It does not change application routes or require account access.
It is a performance measurement helper, not the planned playlist/sound
regression suite. The existing six playlist tests passed.

No publishing, database edits, mood switching, advertiser portal or payments.
