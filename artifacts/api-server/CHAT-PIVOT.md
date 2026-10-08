# Historical pivot report

The uploaded-photo/university update supersedes this report's active avatar,
facial-mood and five-room wording. See `PROFILE-UNIVERSITIES.md` for the current
account/profile flow. Retention, financial-data and private legacy-history
constraints below still apply.

# Streamtalk text-chat pivot

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
publish presence and chat state to current members and new arrivals. Background
playback is now a client-side ordered promo playlist, not a room mood statistic.
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

## Promo playlist (replaces the background mood system)

The owner approved removal of background mood detection, scene mappings, effects,
timers, old forest media and seasonal clips. No background selection examines chat.
The unused database atmosphere column is retained without reading or writing it;
there are no schema migrations or account/message data changes for this replacement.

`artifacts/we-buggin/src/chat/promo-playlist.ts` defines upload order. The four
validated, unique MP4s live in `artifacts/we-buggin/public/promo-videos/`.
`PromoBackground.tsx` mounts one muted, inline video at a time and advances on
completion; the last clip returns to the first. Sound is opt-in for each entry.
Playback pauses on hidden pages, respects reduced motion, skips failed/stalled
clips, and becomes plain dark if none play. No still poster, shuffle, simultaneous
players, sentiment service, advertiser portal, payment or expiration system.
The single 40% black tint and existing chat controls are preserved.

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
