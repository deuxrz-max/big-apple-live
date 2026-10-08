# Streamtalk Phase 3 — university chat interactions

## Additive development migration

`lib/db/migrations/phase-three-university-chat.sql` adds:

- `chat_rooms.topic`: nullable text. Existing rows are not backfilled. The six
  owner-supplied topics are defaults when the new field is null. Overflow
  universities resolve their parent's topic, not their own.
- `social_messages.whisper_history_id`: nullable UUID referencing the persistent
  university history ID, with an index on that column and message timestamp.
  Existing private messages remain null and continue working unchanged.
- `university_ignores`: account/target primary key, account-profile foreign keys
  and a no-self-ignore constraint. This is separate from bilateral Block.
- `university_preferences`: account primary key and nullable `rules_seen_at`.

Only the development database was migrated. No existing data was backfilled,
deleted or rewritten. A build does not publish the app.

## Privacy boundaries

The authenticated university-session endpoint requires the caller's live
`X-Room-Session`. People metadata is resolved from that university's existing
presence. Photos use the existing review/privacy filter, including blocked-photo
hiding. The global existing moderator table supplies badges; no roles are granted.

Whisper sends use the same private-message transaction, bilateral contact/block
checks, idempotency, 1,000-character maximum and 30-per-minute sender limit as
the normal Messages page. The university history ID is derived on the server.
Whispers never call the room broadcaster or enter public room history.
Inline reads select only messages where the authenticated caller is sender or
recipient, in that university history, with block and personal-ignore filters.
The normal Messages page retains its existing history/read/clear behavior and
does not apply Ignore. The room polls private whispers every three seconds.

Ignores are one-way and account-wide. Room history and realtime accepted events
filter ignored authors for that viewer; other members and moderator queues are
unaffected. Unignore refreshes room history, including changes from other devices.
The People list retains ignored people with an Ignored marker.

The first rules card is dismissed only after its acknowledgement saves. Closing,
Escape, outside click and Got it use the same save path; Rules can reopen it.

## Verification

Run `pnpm --filter @workspace/api-server run test:university-chat` for the new
database/HTTP suite. It uses synthetic Clerk request identities in its isolated
Express server, not actual Clerk login, and removes only its own fixtures.
Coverage includes third-person privacy and separate room histories, blocks in
both directions, per-viewer Ignore versus normal Messages, review-filtered photos,
moderator badges, overflow topics, account-scoped rules and private-message limits.

Existing `test:rooms`, `test:chat`, `test:social`, `test:community`,
`test:profiles`, `test:photos`, `test:photo-retention`, `test:safety`, plus the web
`test:beams` and `test:atmosphere` remain the regression checks.
The separately archived web `test:live` has a known missing
`controlRoomMicrophone` fixture export; Phase 3 does not reactivate broadcasting.
