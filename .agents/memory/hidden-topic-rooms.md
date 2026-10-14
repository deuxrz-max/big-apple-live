---
name: Hidden topic rooms
description: Preserve room data while temporarily removing public topic rooms from discovery and playback.
---

Treat Directory visibility as an explicit allowlist separate from the full room configuration. A hidden room remains stored, including its chat history and saved video pool, but cannot be joined, included in public playback schedules, or have its saved pool maintenance run. Existing users in a room being hidden should be redirected to the Directory.

**Why:** The owner wants to rotate the public room lineup without losing saved history, settings, or accumulated YouTube queues, and freed quota should serve the rooms that remain public.

**How to apply:** Change the Directory allowlist, guard room entry and video transition timers with it, and scope YouTube refill and sanitization to visible room IDs and their active overflow instances. Never delete hidden room or pool rows as part of hiding them.
