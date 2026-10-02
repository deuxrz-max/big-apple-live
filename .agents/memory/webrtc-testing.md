---
name: Headless WebRTC verification
description: Distinguish browser media verification from shell runner availability in this environment.
---

The managed test browser and the workspace shell have different media/browser
capabilities. Granting microphone permission does not guarantee a capture device,
and installing Playwright Chromium does not guarantee its Linux shared libraries.

**Why:** Native capture was unavailable in browser tooling, while the shell
Chromium runner could not launch because of missing system libraries. A real
two-peer browser test succeeded with synthetic oscillator input.

**How to apply:** For headless audio checks, supply synthetic media without
mocking RTCPeerConnection or signaling. Require remote audio tracks, playback,
bidirectional RTP bytes, generation changes on reconnect, and ended local tracks
on leave. Distinguish browser verification from a committed runner actually
passing; never report a blocked runner as a passing test.