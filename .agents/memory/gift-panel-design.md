---
name: Gift panel rounding exception
description: Owner requested reference-style gift sheet, explicitly allowing rounded panel corners and quantity pills.
---
The gift panel is an explicit exception to the app's square-shape rule: use rounded top sheet corners, a balance pill, quantity pills and rounded selected gift tiles/Send. Keep user photo frames square and whole.

**Why:** The owner requested a reference-style bottom gift sheet with these rounded controls, while leaving unrelated screens unchanged.

**How to apply:** Keep rounding and material overrides scoped to this sheet; preserve existing recipient selection, quantities, catalog, and success-only auto-close/error-open behavior.
