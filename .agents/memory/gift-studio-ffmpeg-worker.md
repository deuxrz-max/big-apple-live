---
name: Gift Studio processing
description: Keep local FFmpeg worker resolution intact and avoid fragile full-resolution mobile WebAssembly encoding.
---

Exclude `@ffmpeg/ffmpeg` from Vite's `optimizeDeps`; the optimizer can otherwise emit a missing `.vite/deps/worker.js?worker_file` path, preventing the on-device processor from starting. For Android Gift Studio, prefer temporary server-side FFmpeg at bounded dimensions and frame rate; keep the local worker for other browsers with timeouts and a server fallback.

**Why:** Large WebAssembly video encodes are fragile on phone memory and can fail without a useful browser error, while the API's FFmpeg path can constrain output size and verify alpha before returning it.

**How to apply:** Keep the exclusion when changing Gift Studio's FFmpeg imports. Use a short processing timeout and real server-side error messages; verify decoded alpha before allowing a result to be saved.
