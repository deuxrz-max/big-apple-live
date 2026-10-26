---
name: Room channel organization scope
description: Three direct-entry video channels and the owner-approved pink-card reward replacement.
---
Each Home channel must open one combined video experience directly, not a category picker or separate subrooms: The Cafe combines Music, Comedy and News; The Screening Room combines Movies, Web Series and History; The Arena combines Sports and Pro Wrestling. Keep the three channels separate, never one global feed.

**Why:** The owner clarified that the earlier grouping-only navigation was not the intended experience: “not three separate boxes when you hit the cafe.”

**How to apply:** Preserve existing source videos, playback functionality and stored source histories while combining video availability. Do not merge historical chat records or delete source pools as a side effect of changing channel discovery.

Rooms discovery must use the earlier compact room-box proportions, not a newly invented balanced layout. Each channel box previews that channel's currently playing video, muted while visible, and opens the corresponding room when tapped. Never substitute an overflow or former category room's video for the destination channel's video.

**Why:** The owner explicitly requested the previous smaller box sizes from layout history and actual moving previews inside them.

**How to apply:** Inspect historical layout before changing dimensions; preserve unified source content and square black-and-gold styling. Pause previews offscreen/on page hide and remove them on room entry to avoid background playback.

The owner replaced the Cauldron concept with Edward's static pink-neon playing card in the existing fourth Home reward tile, alongside Arena. Display the single winner's name inside the card. Go Live stays immediately below the grid. Remove cauldron visuals and fill-triggered reward logic when implementing the replacement, preserving unrelated card-game functionality.

**Why:** The owner revised the feature to “one winner” and six random draws rather than cauldron fill.

**How to apply:** Use the uploaded static reference and uploaded shuffle video, with transparent shuffle/reveal replacing Overflow globally across rooms. If either asset is unavailable, report the dependency; do not substitute unrelated artwork. The rounded pink-card reference is explicitly approved, not permission to round unrelated app surfaces.

Reward eligibility comes from claiming the daily 25 coins, never room seats/presence, purchases or gifting. Respect the earlier opt-out requirement. Schedule six random draws within the daily cycle anchored to 3 AM Eastern, not six draws at reset. Each draw has one eligible winner and one random catalog gift or entrance effect in their bag, excluding hidden system assets. A winner is ineligible until a rolling 24-hour cooldown expires, independent of daily reset.

**Why:** The owner explicitly changed three winners to one, specified six random draws, and limited each user to one win in any 24 hours.

**How to apply:** Keep the reward system separate from the card-game engine and payment switches. Inspect actual claim/reset and draw implementation rather than assuming earlier proposed cauldron behavior exists.

Daily-cycle time is Eastern wall-clock 03:00, while the win cooldown is exactly 24 elapsed hours; a DST cycle can therefore be 23 or 25 hours.

**Why:** The owner requires the existing Eastern reset and a separate rolling 24-hour win limit. Treating both as a fixed UTC day would violate one of those rules.

**How to apply:** Keep these clocks separate when adjusting schedules or eligibility. The daily coin claim previously used midnight UTC despite the earlier requested Eastern reset; do not restore that older behavior.

Conservative preview defaults: no prize when a draw has no eligible entrant or active prize; do not invent winners. No retroactive awards for elapsed slots at first initialization or expired previous cycles. Rejoining after opting out waits for the next daily claim.

**Why:** These unspecified cases should not create extra prizes, silently invent an entry, or show fabricated announcements.

**How to apply:** Present them as implementation defaults open to owner revision, not as rules the owner explicitly chose.
