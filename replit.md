# Streamtalk

The owner renamed We Buggin to Streamtalk and selected the uploaded neon shield/
Wi-Fi logo. Use Streamtalk in user-facing branding. Preserve existing artifact paths,
package names, storage keys, account identifiers and data; this is the same app.
The owner selected the separate neon shield/microphone artwork for sign-in and
approved removing its “Verified Broadcaster” wording; do not present that artwork
as an account-verification badge. Keep the existing Clerk sign-in flow.

## Approved Phase 2 visual direction

Use the LiveMe-inspired Streamtalk theme: #151518 backgrounds, #1D1D23 panels,
purple #9D1DFF to #5E00FF primary actions, pink #FF268F to #E222FF highlights,
Montserrat in normal case, rounded cards and circular profile photos. The
Directory uses six generated, unbranded portrait streaming-equipment covers,
with purple/pink gradients retained only as image-load fallbacks. Covers contain
no people, text or platform logos. Card headcounts display numbers only with
accessible people-count labels; card taglines are removed and the search
placeholder is “Search.” Me opens profile editing and includes a Community link;
the Directory action row retains only Sign out.
Retain the existing square logo/icon and cleaned full-shield sign-in artwork;
the original tall uploads contain the removed verification claim.
This is visual-only scope, not authorization for later phases. Preserve accounts,
moderation, university capacity/isolation and financial behavior. The university
promo-video background currently has no tint for the owner's preview readability test. Preview only;
do not publish. The public Directory may show aggregate presence counts, never
participant identities or messages.

Adults-only social chat universities with existing named accounts, users' uploaded
profile photos, persisted messages, live presence and an ordered promo-video background.

## Approved Phase 3 university interactions

Universities now have a desktop People column and a mobile People drawer, with
approved photos (initials for unapproved photos), display names and badges only
for the existing moderator role. The uploader can see their own pending photo
with its review label. There is no host appointment system.
Click another person's row or message name for Whisper, View profile and
Ignore/Unignore. Whispers reuse private messages and their existing contact,
block, length and rate rules; inline whispers are never room broadcasts.
Ignore is account-wide and server-persisted, hides university messages/whispers
only for that viewer, and does not affect the normal Messages page or replace Block.
Favorites now uses a Directory-themed photo-only gallery. Only unblocked saved
favorites expose live university names; choose the account's most recent unexpired
heartbeat if multiple universities are open. Refresh every 15 seconds and on
visibility/focus. Recheck location on tap; do not redirect to a changed or empty
location. Enter through the existing university route, access gates and cap/overflow
checks. Offline favorites still link to their profiles. No presence leases are renewed
by gallery reads, and pending/rejected photos continue to show neutral initials.
Keep the compact university name, parent-inherited topic and Rules button.
House rules are acknowledged once per account on the server and can be reopened.
The migration is additive and development-only; existing messages/accounts/photos
must never be reset. This is not authorization for later phases or publishing.

## Current product: text chat

The main experience is six independent universities labeled LiveMe, Bigo
Live, Tango Live, TikTok, Instagram Live and Super Live, in that order. They are not broadcast integrations
and must not be presented as affiliated/endorsed. Preserve users, Clerk login,
existing accounts, messages and profile logic. Do not reactivate broadcasting
seats or camera/microphone prompts in active routes. The owner approved a new
24-member university cap (not the archived twelve-seat Beam limit).
`UNIVERSITY_MEMBER_CAP` in `src/lib/university-config.ts` is the single setting.
Moderators may enter full universities and do not consume member seats.
Full universities offer numbered overflow universities with independent persistent
histories; empty overflow universities are hidden from the Directory.

Use "university/universities" in user-facing text; preserve internal room IDs/routes/events.
These are social spaces for optional sharing/learning broadcasting techniques, not
mandatory lessons, courses or enrollment.
Users upload their own profile photos; missing photos use neutral initials.
All new and pre-existing uploaded photos require human moderator review. Pending,
rejected and flagged photos are private to the uploader and moderator review;
other members see initials unless the selected photo is approved. No sexual or
explicit photos: the owner wants a professional university environment.
Moderator access remains operator-managed through `chat_moderators`; never grant
it automatically. See `artifacts/api-server/SAFETY-PHASE-1.md` for instructions.
Each profile may keep up to four saved photos and select one main photo. The
“+ Click to add” control uploads photos; all saved photos appear on the profile.
Every app screen has fixed bottom navigation: Home, Follow, Message and Me,
without a video button. Use existing Directory, favorites, inbox and Edit Profile
routes; signed-out visitors can sign in to use the protected destinations.
The cap applies to selected profile photos, not lifetime uploads. Preserve all
selected photos during retention cleanup; removed photos keep the approved
30-day unused grace period.
Chat message author names open the person-action menu; View profile retains the
existing profile destination. Do not put photos beside message author names,
private chat headers or inbox conversation rows. The approved Phase 3 People list
is the exception: it shows review-filtered photos, as do existing profile pages.
Preserve profile privacy/block rules.
No branded characters, hair/portrait pickers or profile-image facial-emoji sync
in active routes. Chat emojis never change photos. Leave obsolete database
identity fields unused for compatibility; never overwrite genuine uploaded photos.
Existing valid profiles are complete; setup resumes only when no saved profile exists.
University backgrounds use the owner's uploaded promo playlist in upload order,
including overflow universities. Play one video at a time, then advance and repeat;
sound starts off on every entry and is enabled only by the user's sound button.
Keep full-screen cover rendering. The owner is testing full-brightness playback:
BACKGROUND_TINT_OPACITY is 0 in PromoBackground.tsx; restore it to 0.4 if requested.
The owner removed university message backings, including purple whisper boxes,
and the translucent desktop People-panel background. Messages now use white text,
pink sender names and tight letter shadows directly over the full-brightness video;
People names have the same shadow. Keep the solid mobile People drawer and
the message input/Send bar unchanged. Reduced motion
or an entirely unplayable playlist shows only a plain dark color, never a poster.
The owner approved mobile-optimized serving copies of the four promo uploads;
preserve the original uploads and regenerate from them, not from lossy public copies.
The owner approved removal of the forest/seasonal clips and the entire background
mood system: no chat/activity/sentiment/keyword/weather-driven scene selection,
effects transport or mood timers. Legacy database fields remain unused, not dropped.
The byte-identical later Project_08-20 upload was removed; the original is retained.
Existing financial data requires
a separate policy decision and must never be erased or silently redesigned.
See `artifacts/api-server/CHAT-PIVOT.md` for retention limitations, migration,
configuration, safety and rollback details.

The historical sections below describe archived features retained for rollback;
they do not override the current text-chat product scope.

## Archived Beam frontend (rollback reference)

The default entry now hosts a frontend-only beam demo: React/TypeScript, a dynamic
black background with subtle slow ambient motion, high-contrast white chrome and
one electric-blue accent, bold condensed typography, and no heavy decoration.
Respect reduced-motion preferences. Beam setup offers 2, 4, 9 or 12 total spots,
including the host. Enforce the chosen room capacity; 12 is the maximum, not the
only room size. The setup starts with a seat-layout preview and selector, inspired
by the user's pre-live reference. Participants use
the supplied illustrated profile pictures, selected manually with their backgrounds
removed to transparency; preserve the faces and full hairstyles, and do not add
emoji/SVG hair overlays. Avatars remain static, while emoji
reactions remain available. Message history is bounded, with no
feed or infinite scrolling. Mock participants and local-only messaging must always
be identified as a demo, not presented as a real network connection.

**Why:** The user explicitly requested an interactive, backend-independent
streetwear-inspired frontend ready to connect to a backend later. Keep its mock
storage separate from real accounts, reserved names, and private room sessions.
The user subsequently requested a dynamic black beam background and background-free
profile images; this replaces the earlier white beam theme, not the legacy account UI.

The frontend lives in `artifacts/we-buggin/src/beam/`; its README documents the
service boundary. Existing account and voice rooms remain at `/user-portal` and
`/rooms/:roomId`, with the previous entry available at `/legacy`.

## Post-signup home

After account creation, greet users on a protected discovery home at `/home`,
inspired by the user's two-column LiveMe reference with bottom navigation.
Keep the dynamic black Streamtalk theme and transparent, static portraits.
First-time profile/name claims also return to this home; profile editing stays
in the existing account portal. The discovery home must label browser-local beam
examples as demos, never invent live streams, viewer counts, notifications or
direct messages. Following demo beams is a device-local preference isolated by
signed-in account, not a server-side social relationship.

**Why:** The user requested a discovery-style greeting after creating an account.
Real accounts and voice-room capabilities remain separate from the beam demo.
Root authentication callbacks must let Clerk finish its handshake before showing
the public demo or redirecting the signed-in user to discovery.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server using workflow-provided PORT
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Room presence remains in memory. Account names/emoji profiles persist in PostgreSQL; Clerk owns account authentication.
- `pnpm --filter @workspace/we-buggin run dev` — web app, using its managed workflow
- `pnpm --filter @workspace/api-server run test:rooms` — room and retained compatibility unit tests
- `pnpm --filter @workspace/api-server run test:safety` — private photo review and overflow integration tests

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (ESM server and standalone browser SDK bundles)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract
- `artifacts/api-server/src/lib/room-store.ts` — room/session state
- `artifacts/api-server/src/routes/rooms.ts` — REST and server-sent events
- `artifacts/api-server/ROOMS.md` — lifecycle, API usage, and limitations
- `lib/room-audio/README.md` — headless audio SDK usage and error handling
- `artifacts/api-server/src/lib/audio-signaling.ts` — authenticated room-scoped SDP relay

## Architecture decisions

- Presence is deliberately ephemeral and single-process for this initial framework.
  This avoids treating database rows as evidence of a currently active user.
- Heartbeat leases are used instead of treating event-stream connections as identity;
  observing a room must not create or preserve a participant session.
- Public participant IDs differ from private session credentials.
- Audio membership is separate from room presence so microphone denial or
  signaling reconnects cannot create duplicate room participants.
- Signaling uses authenticated fetch-based SSE plus targeted SDP POSTs to reuse
  the existing transport without putting credentials into stream URLs.
- Peer audio is a small-room mesh. Stream generations fence stale messages and
  deterministic offer direction avoids negotiation glare.

## Product

Users can create a room with a unique shareable ID, join by ID, keep an active
participant session, leave, and subscribe to live participant snapshots.
Participants can also exchange peer-to-peer microphone audio through the
headless SDK, with reconnection and permission/error handling.
Users chose persistent accounts so people can keep dedicated names.
Account names are reserved case-insensitively and kept after first claim.
Emoji identities use the OpenMoji library, Male/spiky hair or Female/ponytails,
and arbitrary six-digit body/hair colors. They are static presence anchors:
no lip-sync, mouth animation, or audio-driven avatar effects.
The supplied male spiked-hair and female ponytail portraits are visual references
for the identity styles. Each user can manually change their own facial expression
whenever they choose, including while in a room; expressions are not tied to gender.

## User preferences

Preserve existing room lifecycle, heartbeat, presence, unique IDs, and private
session credentials. Emoji/signup/room UI is now requested; avoid unrelated UI.

## Gotchas

- Restarting the API clears rooms and participant sessions.
- Multiple API instances require shared state and pub/sub first.
- Regenerate API types after OpenAPI changes.
- Native WebRTC requires HTTPS/localhost and microphone permission. Public STUN
  is not enough on every network; TURN can be supplied through SDK iceServers.
- Clerk cookie authentication applies to account/profile endpoints only. Do not
  interpret the audio SDK's private session Bearer capability as a Clerk JWT.
- Registered room identities must be derived on the server from the signed-in
  user's profile; never trust a posted name, account ID, or avatar as ownership.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
