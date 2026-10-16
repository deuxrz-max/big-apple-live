---
name: Gift Studio FFmpeg worker
description: Vite development dependency optimization can break FFmpeg's worker URL import.
---

Exclude `@ffmpeg/ffmpeg` from Vite's `optimizeDeps`; the optimizer can otherwise emit a missing `.vite/deps/worker.js?worker_file` path, preventing the on-device processor from starting.

**Why:** Gift Studio runs FFmpeg locally in a worker and needs Vite to preserve the package's worker URL rather than rewriting it into the dependency cache.

**How to apply:** Keep the exclusion when changing Gift Studio's FFmpeg imports, and check a dev-preview load after dependency or Vite config changes.
