# We Buggin text-chat pivot

## Implemented flow

Sign in with the existing Clerk account → explicitly attest that you are 18+ →
open the room directory → choose LiveMe, Bigo Live, Tango Live, TikTok or
Instagram Live → join automatically with your saved profile → read and send
text. These labels describe independent communities, not live integrations.
There are no camera/microphone requests, broadcasting seats or twelve-user cap.
Older history loads in pages of 60 messages. Presence still uses heartbeat
leases and expires when the browser stops participating.

Existing account/profile editing, named identities, discovery, private messages,
favorites, blocks and the supplied avatar artwork are reused. Optional platform
and handle fields are added to existing social settings and explicitly
self-listed/unverified. External ownership verification was not added.

## Retention and rollback

Clerk authentication, passwords, IDs and account-provider settings are unchanged.
The migration does not rewrite any existing profile, message or financial row.
Legacy room-message IDs, codes, history-incarnation UUIDs, sender snapshots and
text remain in `room_messages`. They are NOT copied into public platform rooms.
Rows without an incarnation or authenticated author binding are not guessed or
backfilled by matching names/codes.

**Legacy limitation:** the former server kept room metadata and active membership
only in process memory. A restart invalidates those ephemeral capabilities.
We cannot safely reconstruct old private memberships, host ownership, expired
room names or unbound histories from a reused share code. Saved legacy messages
are retained as private archive data, not made publicly accessible. Old Beam
links now direct people toward the text directory; legacy room codes do not
silently join one of the public rooms.

New text rooms have stable PostgreSQL history IDs and memberships. Restarting
creates fresh presence credentials but reuses the same history and per-account
participant ID. The existing SSE chat transport is retained; server snapshots
publish the selected room atmosphere to current members and new arrivals.
Archived broadcasting UI/signaling modules remain on disk for code rollback;
signaling is not mounted and old broadcast actions return 410.

Use the Replit checkpoint preceding the pivot if code rollback is needed. The
SQL changes are additive and old code can ignore them. Do not drop new tables or
columns as an automatic rollback: they may contain new messages, memberships,
reports and moderation decisions.

## Migration

Reviewed SQL: `scripts/chat-pivot-migration.sql`.
Runner: `src/scripts/chat-pivot-migrate.ts` (execute from workspace root).

```
pnpm --filter @workspace/api-server exec esbuild src/scripts/chat-pivot-migrate.ts --bundle --platform=node --format=esm --banner:js="import { createRequire as cr } from 'node:module'; const require=cr(import.meta.url);" --outfile=/tmp/chat-pivot-migrate.mjs
node /tmp/chat-pivot-migrate.mjs
```

The idempotent transaction adds room registry, membership, adult attestation,
moderator and report tables; nullable external-profile fields; authenticated
author binding and non-destructive message visibility. No data is reset.
Development migration counts before/after: profiles 16/16, room messages 30/30,
ledger entries 5/5. Test-created rows are distinct from these original rows.
This is a DEVELOPMENT migration; it was not applied to a published database.

## Independent atmosphere

Configuration: `src/lib/community-atmosphere.ts`. Default window three minutes,
busy threshold 12 messages from at least three distinct authors, quiet threshold
five, sustained candidate 20 seconds and minimum dwell 60 seconds. Counts use
only committed, non-hidden messages in that exact room history; joins/heartbeats
do not count. Hysteresis keeps intermediate activity from flickering.

The server owns scene and transition timestamp. City/calm selection is currently
activity-based. Calm means quiet, NOT classified friendly sentiment.
No classifier or external sentiment service is configured or called.
Volcano/semantic-friendly decisions remain disabled; there is no keyword
fallback. The classification interface requires multi-message/multi-author
evidence and confidence; its uncertain branch is not hostility.

Inspected app dependencies/configuration and integration availability. No
connected suitable classifier was available. A feedback connector requiring
setup is not treated as a configured sentiment model. Before adding a provider,
obtain approval for message-content transfer and provider-specific usage costs,
retention, data processing terms, region and whether data can train models.
Batch only necessary recent text and omit account identifiers where possible.
Current added external sentiment API cost: none.

Video mapping: `artifacts/we-buggin/src/chat/video-config.ts`. All three `src`
values are intentionally null; **final city/cafe/volcano clips are NOT supplied**.
Current backdrops are static gradients, clearly identified as placeholders.
When licensed optimized clips are configured, videos are muted, autoplay,
inline, input-transparent and loop independently of scene selection, with a
dark overlay, 1.8-second crossfade, hidden-page pause, error fallback and static
reduced-motion rendering. Do not switch on an `ended` event. The six-second
blue WebM under `tests/fixtures` is a synthetic playback TEST fixture only,
not a production background.

## Trust, safety and financial decisions

Adult confirmation is stored and checked by the server, but is self-attestation,
NOT verified age. Blocking applies to history and realtime delivery in both
directions. Basic spam limits: five messages/account/ten seconds across rooms.
Reports persist with authenticated room membership and a moderation queue.
Moderators can dismiss, hide without deleting, room-mute, or restrict account
access (including stopping re-attestation from bypassing a restriction).
Mood visuals have no moderation authority and award no credits.

**Before launch:** assign trusted reviewers, set an operator/support contact and
report-response process, and decide whether stronger age assurance is required.
Do not grant moderator access to the first signup or from client-provided data.
An operator can grant a reviewed EXISTING Clerk account ID in `chat_moderators`
using a trusted database operation. Do not print credentials or user IDs in logs.
Restriction/room-mute reversal currently requires a trusted operator updating
the corresponding admission/membership row; it is not a user-controlled action.
Reports are queued, not claimed automatically reviewed.

Existing virtual gifts, wallets, inventories, rewards and credit ledger remain
unchanged and are flagged for a separate policy decision. No payout processor
was found in the existing social modules. No financial migration or reset was
performed and no connection to platform balances/payouts is implied.
Plain-text labels/non-affiliation statements are presentation precautions,
not legal clearance.

## Verification commands

`pnpm run typecheck`; API `test:rooms`, `test:chat`, `test:social`,
`test:community`; authenticated browser verification.
The community integration test uses real PostgreSQL and cleans only its own
fixtures. Its separate clock tests exercise scene thresholds, not an enabled
sentiment service. See the final implementation report for browser checks
actually executed and any runner limits.

### Results from this implementation

- Workspace typecheck: passed.
- API tests: `test:rooms` 25/25, `test:chat` 1/1, `test:social` 7/7,
  `test:community` 3/3. The chat/social/community integration tests used real
  PostgreSQL, not an in-memory database mock.
- Frontend production build: passed with the artifact's `PORT` and `BASE_PATH`
  supplied to the one-off command. API build/start passed through its workflow.
- Public directory HTTP 200, unauthorized message-history HTTP 401,
  obsolete audio HTTP 410; public mobile screenshot rendered correctly.
- Browser: public labels/disclaimer, adult API guards, saved self-attestation
  and signed-in directory passed in one synthetic session. getUserMedia trap
  counted zero calls in executed flows.
- Full protected-room browser verification remains BLOCKED: repeated synthetic
  Clerk fixture attempts returned 401 or lost the session before profile save.
  The isolated retry also failed. This does not establish whether a real-user
  login is broken; real signup/password/login and multi-user browser messaging,
  moderation and composer checks were not completed. Do not claim launch ready.
- Native component playback independently passed in an unauthenticated browser:
  actual RoomAtmosphere component with the synthetic six-second WebM wrapped
  from 5.927947s to 0.043536s without changing scene; muted/autoplay/inline/loop,
  1.8s crossfade, outgoing pause, invalid-media fallback, reduced-motion static
  rendering, input transparency and overlay passed. Browser-memory mappings
  were restored to null. This is COMPONENT verification, not room E2E.
- Hidden-page pause is implemented but unverified in this runner: bringing
  another tab forward did not make `document.visibilityState` hidden. No fake
  hidden signal was substituted for a real background-tab test.

## Changed source files

Frontend (under `artifacts/we-buggin`):
`src/App.tsx`; `src/chat/ChatApp.tsx`, `chat.css`, `useTextRoom.ts`,
`RoomAtmosphere.tsx`, `video-config.ts`; `src/social/PeoplePages.tsx`,
`SocialApp.tsx`; `tests/fixtures/atmosphere-loop.webm`.

API (under `artifacts/api-server`):
`package.json`; `src/app.ts`, `src/index.ts`;
`src/lib/community.ts`, `community-atmosphere.ts`, `community.test.ts`,
`room-chat.ts`, `room-store.ts`; `src/lib/social/core.ts`, `people.ts`;
`src/routes/community.ts`, `chat.ts`, `identity.ts`, `index.ts`, `rooms.ts`;
`src/scripts/chat-pivot-migrate.ts`; this `CHAT-PIVOT.md`.

Shared/database:
`lib/api-spec/openapi.yaml`, `social.openapi.json`;
`lib/db/src/schema/chat-community.ts`, `room-messages.ts`,
`social-settings.ts`, `index.ts`; `scripts/chat-pivot-migration.sql`.
Generated output refreshed in `lib/api-client-react/src/generated/` and
`lib/api-zod/src/generated/` (do not hand-edit).

Project guidance: `replit.md` and `.agents/memory/` scope/testing notes.
