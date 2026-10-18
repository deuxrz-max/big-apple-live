---
name: Shared 3D preview limits
description: WebGL capability limits in the Replit app screenshot browser and safe fallback behavior.
---

On October 18, 2026, the app screenshot browser could not create a WebGL context. The shared 3D canvas initially caused the app-level fallback to appear; the normal app rendered once the decorative scene was guarded and isolated.

**Why:** A preview runner's GPU/WebGL limitation should not make the whole app appear broken or be mistaken for a device-camera or app-route failure.

**How to apply:** Keep the 3D layer optional behind a capability check and a local error boundary. When the screenshot runner lacks WebGL, verify the regular app remains visible and report that scene rendering needs a WebGL-capable browser or real device.
