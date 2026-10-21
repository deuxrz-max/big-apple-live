# Room card game — development notes

## Implemented in development

- The server exposes owner-only `dealsEnabled`, `payoutsEnabled`, and `cardDisplayEnabled` switches. All default to `false`; disabling a switch prevents later deals, payouts, or card display respectively.
- The shared game clock uses a fixed starting point of 2026-01-01 00:00 UTC and a 75-minute cycle for every room. A full game schedules cards at minutes 15, 30, 45, 60, and 75.
- Each room/game stores a securely shuffled 52-card deck and unique dealt-card rows in the database. Seats lock at the first deal; later arrivals wait for the next game. The engine supports up to ten seats without changing the current room layout.
- Reconnect grace is 90 seconds. A disconnected locked-in seat returns during that grace; after it expires the player is out for that game.
- Twos are wild. Scoring order is five of a kind, straight flush, four of a kind, full house, flush, straight, three of a kind, two pair, pair, and high card. Aces can be high or low in a straight.
- The prize is 100 ordinary coins total per room/game. At least three eligible, non-bot accounts must finish with five cards. Ties split the 100 coins; remainder coins follow seat order starting at the beam host’s seat, or seat 1 in ownerless rooms. Wallet and ledger writes are in the same transaction as the unique game result.
- There is no buy-in. The daily winnings-cap field exists and is unset (`NULL`).

## Operational defaults

- If the server misses a scheduled deal, it catches up on return only while the game is still running; an unfinished game past its end is voided without a payout.
- If a room session ends mid-game, the game is voided without a payout. App-run public rooms have no creator or close button; their session ends when the room is deactivated or unregistered, and a new room incarnation gets a new history ID.
- A kicked person is blocked from that room incarnation until it ends. Host blocks are persistent across all livestreams opened by that host and are removed only by unblocking.
- On app-run public rooms with no owner, existing Deux Wild moderators are the people who can moderate. Livestream hosts and existing moderators can moderate livestream participants.

## Notes only — not implemented

- Cash-out eligibility threshold: 30,000 coins.
- Future card visuals and interactions: black cards with gold edges; distinct shimmering twos; a logo deck above the gift box; a five-second winner display with coin burst; rules and beginner guide; profile view with a fanned hand.
- These future screens and effects are not built. No casino or streetwear rebrand is planned.
