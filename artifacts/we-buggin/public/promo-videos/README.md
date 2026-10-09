# Streamtalk university promo backgrounds

The same ordered playlist is used in every university, including overflow rooms.
Serving copies are mobile-optimized H.264 (up to 540×960, original aspect ratio
and frame rate, CRF 26, 1 Mbps maximum video bitrate, two-second keyframes).
MP4 faststart puts metadata before media for progressive playback. Original AAC
audio is stream-copied without conversion and remains available through the
opt-in sound button. No clip plays simultaneously with another.

| Order | Served file | Original upload |
| --- | --- | --- |
| 1 | 01-immortal-studios.mp4 | grok_video_2026-09-04-11-49-45_1791486375400.mp4 |
| 2 | 02-moonlit-characters.mp4 | video_1788023530265_1791486446786.mp4 |
| 3 | 03-red-tunnel.mp4 | Project_08-20(1)_Full_HD_1080p_MEDIUM_FR30_1791486473729.mp4 |
| 4 | 04-additional-project.mp4 | Project_08-29_Full_HD_1080p_MEDIUM_FR30_1791486565694.mp4 |

The later Project_08-20 upload was byte-identical and was deleted with the owner's
approval. Playlist order is defined in `src/chat/promo-playlist.ts` in the web app.
There is no scene, activity, keyword, weather or seasonal background selection.

Original uploads in `attached_assets/` remain untouched. To regenerate serving
copies from those originals with FFmpeg and FFprobe installed, run
`bash artifacts/we-buggin/scripts/optimize-promo-videos.sh` from the workspace.
This replaces only the four public MP4s after all four pass full decoding.
See `artifacts/we-buggin/docs/promo-video-optimization.md` for measured savings
and development-preview playback verification.
