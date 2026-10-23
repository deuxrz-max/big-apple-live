---
name: Shared 3D preview limits
description: WebGL capability limits in the Replit app screenshot browser and safe fallback behavior.
---

On October 18, 2026, the app screenshot browser could not create a WebGL context. The shared 3D canvas initially caused the app-level fallback to appear; the normal app rendered once the decorative scene was guarded and isolated.

**Why:** A preview runner's GPU/WebGL limitation should not make the whole app appear broken or be mistaken for a device-camera or app-route failure.

**How to apply:** Keep the 3D layer optional behind a capability check and a local error boundary. When the screenshot runner lacks WebGL, verify the regular app remains visible and report that scene rendering needs a WebGL-capable browser or real device.

Software WebGL2 in the workspace Chromium can verify geometry, input, lifecycle and fallback behavior even when the managed screenshot/test browser has no WebGL.

**Why:** The two browser environments expose different graphics capabilities. Software rendering is not evidence of Android GPU speed, heat or battery use.

**How to apply:** For a capability-limited runner, use the installed Chromium with ANGLE/SwiftShader and explicitly label results software-rendered. Keep real-device performance unverified.

For card materials, preserve printed artwork as an unlit base and layer satin/foil lighting independently; use metallic shading for the dimensional edge.

**Why:** Applying environment reflections directly to the printed face washed deep-black artwork grey and made satin brushing overpower the illustration.

**How to apply:** Inspect both resting and tilted cards against the original image, keep the coating faint and ensure that full artwork and borders remain readable.

A working environment reflection alone is not enough evidence that the owner can see foil shimmer on Android. Use a clearly moving directional gold band without bleaching the underlying print.

**Why:** The owner reported no visible shimmer on their Android phone despite the earlier software-WebGL rendering and tilt checks passing.

**How to apply:** Verify the light band changes position with touch and remains apparent when untouched. Distinguish software-rendered visual checks from real-device appearance and performance.
