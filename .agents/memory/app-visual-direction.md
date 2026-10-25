---
name: Deux Wild mobile interface direction
description: Owner-approved app-wide mobile redesign scope and preserved identity and behavior.
---

Deux Wild should feel like a polished mobile social broadcasting app, not a website. The owner approved an app-wide interface and interaction redesign covering home, rooms, full-screen broadcasts, profiles, chat, gifting, Store and settings. Preserve recognizable deep black and gold, readable content, comfortable touch targets, consistent back navigation and natural sheets. Seek the premium lively quality of LiveMe without copying its branding. Lighting and motion support the interface, not replace it.

**Why:** The owner explicitly clarified “It's the whole app” and “have it look more ... like an app ... than a website.” This supersedes the older room-only styling restriction for this redesign.

**How to apply:** Work inside the current app; no Unity migration or engine rebuild. Do not change accounts, balances, gift artwork, business settings, moderation, card deck/rules/timers or media/audio behavior as part of visual work. Keep all room seats audio-only, themed TV and the mic-driven local audio split intact, and cameras exclusive to full-screen Go Live. Keep the satin/tilt card prototype owner-only; do not expose or replace it. Avoid performance-heavy effects and report Android verification limits honestly. Preview changes are not permission to publish.

The Joker card finish is the visual anchor for the entire app: shared satin black with fine grain, beveled gold edges, soft depth/shadow and consistent lighting, radii and material thickness. Apply the finish on top of the existing mobile redesign, not as a replacement layout.

**Why:** The owner explicitly requested “make the finish of the card the anchor for the entire app” so everything looks uniform.

**How to apply:** Reuse shared material tokens across controls, navigation, sheets, seats/avatar frames, lists, chat, timers, badges and broadcast controls. Preserve photos/artwork/video, semantic colors, username and gifting-level colors and all behavior. Moving foil is a selective highlight for pressed controls, the active tab, the card and premium gifts—not a continuous animation on every surface. Do not extend WebGL rendering from the private card prototype into ordinary app surfaces.

Deux Wild uses squares and rectangles, not oval or circular frames. This includes profile pictures, avatar frames, seats, placeholders, highlights, chips, buttons with content and panels. Going forward, only use rounded or oval shapes when the user asks for them; there is no standing exception for small icon buttons. All user photos must show the whole uncropped image, as in Chess, with black letterboxing where needed. Board tiles and selection highlights must be true squares.

**Why:** The owner repeatedly rejected ovals, reported clipped seat labels and Chess photos, and explicitly said “stop using oval shapes around things unless asked for.” This supersedes the earlier exception allowing circular profile pictures and avatars.

**How to apply:** Shape corrections must preserve the black/gold finish, numbered gifter shield artwork and all behavior. Keep complete seat labels inside their boxes on narrow phone screens. Use the shared rectangular shape policy instead of adding circle/pill classes or masks. Test with all shared styles loaded, since generic button styling can round Chess squares. Home launch tiles retain a room-card footprint and readable, non-overlapping icon and text.
