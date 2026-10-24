---
name: Room composer regression checks
description: Keep isolated browser style coverage representative of the real mobile room composer.
---
Room regression fixtures must load the mobile-shell and shape styles as well as legacy room styles, and assert the input's usable width, not merely its visibility.

**Why:** A legacy zero-width input relied on flex-grow. The mobile redesign changed its parent to grid, leaving only 10 pixels of input padding visible. A fixture without the mobile-shell stylesheet passed while the actual phone interface was broken.

**How to apply:** After changing room composer layout or global styles, check a meaningful input width at narrow phone sizes, typing, send/Enter, and receipt by a second isolated viewer. Keep fixture traffic disconnected from real accounts and databases.

Preserve production CSS layer declaration order in browser fixtures as well as including all relevant styles. Loading the satin-finish layer before the shape layer reverses their important-rule precedence and can falsely show circular frames that the actual app overrides. Touch-specific tests must explicitly enable touch support in their browser context.
