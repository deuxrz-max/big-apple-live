---
name: Transparent media assets
description: Preserve genuine alpha for gift and room-effect media across browsers.
---

The owner confirmed that Moonfox stays transparent in the app.

**Why:** This confirmation reflects a user-visible result that code inspection alone cannot establish.

Green-screen video conversion must be checked on decoded frames and composited against light and dark backgrounds. Do not trust a codec/container alpha flag by itself: FFmpeg may advertise VP9 alpha without exposing it in its decoded pixel format. Entrance effects must remain silent and animated; never fall back to a badge still. For transparent gift media, use alpha VP9 WebM on Chromium/Android and a genuinely animated transparent fallback for Safari, verifying the decoded frames and actual browser composite.

**Why:** The user explicitly requires every entrance effect to be silent and animated, with the badge image reserved for name/profile use. Earlier code showed still badge art when animation playback failed, and the uploaded Lion MP4 had a baked green background.

**How to apply:** Keep uploaded originals untouched, preserve native alpha or remove backgrounds frame-by-frame, strip audio when required, inspect decoded alpha and light/dark composites, and use only animated fallbacks. If animated formats fail, show no effect rather than a badge still.

The installed FFmpeg build's native VP9 decoder drops the auxiliary alpha channel even when the WebM carries `ALPHA_MODE=1`; explicitly decode transparent VP9 with `libvpx-vp9` for server verification and conversions. In this environment `libwebp_anim` emitted a one-frame invalid WebP, while FFmpeg APNG preserved animation and alpha.

**Why:** A synthetic transparent VP9 clip appeared opaque under the native decoder, and the nominal animated WebP fallback was not actually animated. Trusting either file metadata or encoder names would have let invalid media pass review.

**How to apply:** Select `libvpx-vp9` when decoding VP9 alpha, verify transparent and visible pixels across multiple decoded frames, and use APNG or another fallback only after confirming it is multi-frame and retains alpha.

A checkerboard visible in uploaded footage can be baked pixels rather than transparency. Do not encode or key it as-is; remove it from every frame and verify the decoded result over both light and dark backgrounds.

**Why:** A replacement gift clip visually resembled a transparency preview, but its MP4 contained an opaque checkerboard. Spatial color-key attempts left a patterned background and damaged white smoke; frame segmentation preserved the subject cleanly.

**How to apply:** Probe the source alpha channel first. If absent, inspect lossless frames, remove the background frame-by-frame, and check moving edges, smoke, and bright trails before encoding browser-specific alpha formats.

The image preview tool may display transparent pixels as a checkerboard; that preview alone does not prove checkerboard pixels are baked into the file.

**Why:** A real-alpha cutout appeared checkerboarded in the image preview, while raw alpha samples and composites confirmed it was transparent.

**How to apply:** Check source pixel alpha and composite against solid light and dark backgrounds before deciding whether the checkerboard is part of the image.

For small public gift assets served from GCS, do not destroy the upstream read stream immediately when a client disconnects before the storage response initializes. Unpipe it from the response and drain it so the storage client does not throw `ERR_STREAM_UNABLE_TO_PIPE` and crash the API process.

**Why:** Early browser cancellation during a range request reproduced an uncaught storage-stream error; the API stayed healthy when the response was detached and the asset stream drained.

**How to apply:** When changing gift-media streaming, test an early client abort and confirm the API continues serving later requests.

Native FFmpeg tests do not validate the browser-side FFmpeg WebAssembly worker. Its core is large, and startup must be exercised in the target browser; bound loading time and show a recoverable error rather than an indefinite spinner.

**Why:** A headless preview run stayed in the local-engine loading stage and the test workspace restarted before it completed, despite native FFmpeg alpha conversion succeeding.

**How to apply:** Keep native alpha verification and browser-worker startup as separate checks, and confirm processing on a real supported phone before claiming the on-device workflow is verified.

Gift Studio background mode is per version: old assets keep their mode and alpha rules; black-background assets remain opaque in storage and use screen blending in every playback surface. Only generated icons remove the black matte.

**Why:** The owner confirmed the simple two-option switch; keeping black-matte removal out of the animation file preserves bright colors and leaves existing gifts unchanged.

**How to apply:** Carry the mode through saved settings and active-media responses, apply black blending to both full and mini playback, and keep alpha checks limited to see-through videos.

Auto-detect only newly uploaded clips, never saved gifts on read. Real transparency takes priority over black-border detection; manual choices must win and persist. Nonblack opaque uploads stay labeled See-through with a warning, but may retain their opaque background rather than being blocked.

**Why:** The owner explicitly requested automatic selection without changing existing gifts, manual override, and nonblocking warnings for scenery or green-screen clips. The See-through label must not imply that automatic detection invents transparency.

**How to apply:** Preserve actual source alpha without chroma keying, sample several low-resolution frames, keep explicit warned opaque retention separate from legacy alpha-required processing, and leave existing saved media untouched.
