# Safety phase 1 — development only

## Approved scope

The owner approved human photo review and a 24-member university cap on 2026-10-08.
No production schema/data changes or publishing are authorized.
No sexual or explicit profile photos: this should feel like a professional university.

## Data preservation and migration

Development-only additive columns:
- `profile_photos.status` (default `pending`), `reviewed_by`, `reviewed_at`.
- `chat_rooms.parent_room_id`, `overflow_number`.

All 9 existing photo records became pending through the new column's default.
No photo files, accounts, selected-photo references, history, messages or financial
records were deleted or overwritten. Four saved photos and the 30-day unused-file
grace period remain unchanged. Unknown legacy image URLs fail closed.

The schema push tool requested an unrelated `chat_rooms` constraint/truncation
confirmation. It was not accepted. Only the five additive columns above were
applied in a transaction using the development database.

## Photo visibility and review

Owners can view their pending/rejected/flagged photos and their status. Other
members receive only approved saved photos; unavailable main photos render initials.
Chat messages and university rosters carry no photo URLs. Authenticated image
requests independently enforce status, selection and bilateral blocking; responses
are `private, no-store`. Moderators can fetch review images, but blocking still applies.
Moderator queue: `/community/moderation`, above the existing chat-report queue.
Approve/reject records the reviewer and time; rejection does not delete anything.
The queue includes staged uploads so unfinished profile setup does not bypass review.

## Add yourself as a moderator (trusted operator only)

1. Sign in, complete your existing profile and confirm that you are 18 or older.
2. In the **development** database, run the following, replacing the placeholder
   with your existing dedicated username (not a display name or email):

```sql
SELECT account_id, username FROM account_profiles
WHERE name_key = lower('YOUR_DEDICATED_USERNAME');

INSERT INTO chat_moderators (account_id)
SELECT account_id FROM account_profiles
WHERE name_key = lower('YOUR_DEDICATED_USERNAME')
ON CONFLICT DO NOTHING;
```

Confirm the SELECT returns exactly your account before running the INSERT.
Refresh the app and open `/community/moderation`.
No owner/moderator rights are granted automatically.
To revoke: delete only that account's row from `chat_moderators`.

## Overflow and presence

`src/lib/university-config.ts` defines `UNIVERSITY_MEMBER_CAP = 24`.
Only non-exempt active heartbeat sessions consume member seats. Moderators are
exempt, can enter full universities, and never displace existing members.
Rejoining the same account uses one session; inactive sessions expire after 90 seconds.
Presence is still single-process and in-memory; restart clears presence, not history.

Full joins return HTTP 409 with a friendly message and `overflow: {roomId, label}`.
The UI offers an explicit Enter button. Numbered overflow rows are created on demand,
reuse their own persistent history on future visits, and are hidden from the
Directory while empty. Their independent history IDs scope chat, reports, mute
state and atmosphere; existing block and spam rules apply.
All universities retain the full-screen `summer.mp4`, single 40% black tint, and
dark-only playback fallback. No seasonal/keyword switching was added.

## Voice cleanup

Removed unmounted audio router, two-browser WebRTC test/config, old standalone
voice-room page and its session/audio hook, `test:audio`, and the browser audio SDK
build step. Broadcasting/audio/microphone endpoints still return 410.

Retained `src/lib/audio-signaling.ts` and its unit test: the existing rooms and
identity compatibility tests reference it. Retained `lib/room-audio` protocol/client
package and workspace dependencies because those tests and the archived Beam
audio hook import it. The archived Beam room/microphone components remain linked
to that hook, but the active app never imports/mounts BeamApp, and `/beams` routes
redirect. Removing those remaining pieces would require a separate archived-code
and compatibility-test cleanup. No database tables were dropped.

## Rollback caution

Keep additive columns/data. Do not restore unrestricted photo-serving code after
review begins; that would disclose pending photos. Use a checkpoint only with an
explicit decision about that privacy consequence.

## Verification performed

- `pnpm run typecheck`: passed after final edits.
- `PORT=24150 BASE_PATH=/ pnpm run build`: passed, including the root typecheck.
  A bare shell build initially lacked the managed workflow's required `PORT`;
  no configuration was changed to work around it. This is a local build, not publishing.
- Existing `test:rooms`: 25 passed; `test:chat`: 1 passed; `test:social`: 7 passed;
  `test:community`: 3 passed; `test:profiles`: 6 passed.
- New `test:safety`: 5 passed, using real HTTP, PostgreSQL and App Storage with
  synthetic Clerk request identities. Covered uploader/pending status, public
  initials inputs, protected image fetches, moderator/non-moderator access,
  approve/reject/flag visibility, blocking, 25th-person overflow, LiveMe 3,
  separate overflow history/reports, moderator exemption and stale seats.
- Photo-decoding test passed. The extended `test:photos` and
  `test:photo-retention` suites did not fully pass: storage operations intermittently
  returned 503. Older photo-publicity assertions were updated for the new pending
  policy; the final remaining failures were storage availability. Do not describe
  these two suites as green.
- Preview signed-out Directory loaded normally. A browser-only harness rendered
  actual source components with synthetic network responses and confirmed review
  labels/actions, restricted access, initials, overflow-link navigation and usable
  input. It did not establish real multi-user Clerk behavior.
- Mobile 390×844 and desktop 1280×800 atmosphere measured full viewport, with
  exact `rgba(0,0,0,.40)` tint. Summer served HTTP 200, but the test browser used
  the dark-only playback fallback, so moving-video playback was not verified.
- Final development database: 9 photos still pending, no moderator accounts.
- Autumn/winter checksums unchanged. No production queries, migrations or publishing.
