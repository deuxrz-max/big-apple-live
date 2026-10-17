---
name: Gift Studio processing
description: Keep local FFmpeg worker resolution intact and avoid fragile full-resolution mobile WebAssembly encoding.
---

Exclude `@ffmpeg/ffmpeg` from Vite's `optimizeDeps`; the optimizer can otherwise emit a missing `.vite/deps/worker.js?worker_file` path, preventing the on-device processor from starting. For Android Gift Studio, prefer temporary server-side FFmpeg at bounded dimensions and frame rate; keep the local worker for other browsers with timeouts and a server fallback. When server processing succeeds, retain the verified source/output briefly in an owner-bound, expiring session so save can use those bytes directly instead of uploading the WebM again; retain a properly typed multipart fallback for expired sessions.

**Why:** Large WebAssembly video encodes are fragile on phone memory and can fail without a useful browser error; a second phone upload can also lose the processed file's MIME/name metadata. Server-side processing can constrain output size, verify alpha, and save the same validated bytes without a redundant upload.

**How to apply:** Keep the exclusion when changing Gift Studio's FFmpeg imports. Use a short processing timeout and real server-side error messages; bind temporary processing sessions to the authenticated owner, expire and delete them, verify decoded alpha before saving, and let browsers fall back to explicit `.webm` multipart uploads.
