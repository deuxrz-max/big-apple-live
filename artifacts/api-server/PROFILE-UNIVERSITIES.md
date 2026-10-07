# Account setup, uploaded photos and university terminology

## Current flow

- Signed-out visitors see the Directory preview, Create account and Sign in.
- Clerk remains the only authentication provider. Email/password signup has a
  confirmation field, validation, verification/resend and Clerk session activation.
  Other existing login providers remain available through Clerk.
- After authentication, the existing adults-only self-attestation remains.
- If no saved profile exists, show profile setup, including direct university links.
  Save the permanent unique handle, editable display name, optional bio and photo
  in one database transaction. A failed save never makes setup complete.
- A saved existing profile is already complete. No backfill or new completion
  flag forces old accounts through setup again.
- Edit profile changes the same profile; there is no second account/profile table.
- Directory order: LiveMe, Bigo Live, Tango Live, TikTok, Instagram Live, Super Live.
  Super Live uses the same persisted membership, history, SSE and atmosphere.
- Universities are optional social chat spaces, not courses or enrollment.
  Internal room IDs, routes and event names intentionally remain unchanged.

## Data preservation and compatibility

The additive development migration left **16 profiles, 31 messages and 5 ledger
entries unchanged**. These were the counts when this migration ran, not expected
counts after new users or test fixtures sign in. Clerk credentials were not changed.
No existing display name, username, bio, message or financial record was reset.

The new photo column defaults to null. Existing branded references are ignored,
so their accounts display initials until a photo is uploaded. Existing genuine
photo values in the new column are preserved by `ADD COLUMN IF NOT EXISTS`.
Old identity/mood fields remain for compatibility, unused by the active UI.
Active chat no longer interprets facial emojis or mutates avatar fields/photos.
Archived Beam modules and dependencies shared with those modules remain unmounted.
They must not be reintroduced into active profile or university pages.

The previous pivot's private legacy-history limitations remain; see CHAT-PIVOT.md.

## Persistent photo storage and validation

`POST /api/me/photo` accepts raw binary from authenticated adults, including before
their first profile save. Maximum original file size: 5 MiB. The server checks
JPEG/PNG/WebP signatures, fully decodes with Sharp, rejects invalid or animated
images and images exceeding 16 megapixels, normalizes orientation and crops to
at most 512x512. Re-encoding as WebP strips EXIF/GPS/XMP/IPTC metadata.

Files go to persistent Replit App Storage under random UUID names. Only object
paths/ownership metadata live in PostgreSQL; no image bytes/base64/passwords.
The profile accepts only the current account's staged photo reference. Temporary
browser preview URLs are never saved. Saving a replacement/removing a photo changes
the existing profile, not the account identity or message text.

`GET /api/photos/:photoId` requires authentication. Unsaved photos are visible only
to their uploader; other accounts can read only the owner's currently saved photo.
Bidirectional blocks are respected. Invalid uploads, missing storage and ownership
errors are explicit. Processing is bounded to four simultaneous uploads and
20 successful uploads per account per hour.

This is file safety/ownership validation, not automated content moderation.
Existing university message reports/moderator controls are preserved; a dedicated
photo review/removal workflow is not claimed. Set a staff response policy before
launch. The owner approved the following photo-retention policy on 2026-10-07.

### Approved photo-retention policy

- Abandoned staged uploads are kept for **30 days after upload**. Replaced or
  removed photos are kept for **30 days after they stop being current**, even if
  the original upload is much older. Selecting an unused photo again cancels its
  expiry. Current profile photos never expire.
- The additive migration gives every existing unused photo a fresh 30-day grace
  period. It does not backdate expiry from the original upload time.
- Cleanup rechecks every profile reference, not just the owner's, under the same
  PostgreSQL account advisory lock as profile saves. In-flight saves win or the
  cleanup skips that busy account. Recent uploads cannot qualify.
- A committed deletion marker makes an expired photo unavailable for saves before
  its file is deleted. If storage fails, the process stops, or the database commit
  fails after file deletion, the record stays marked for an idempotent retry.
  Missing files count as already deleted. An expired reference is explicitly
  rejected with instructions to upload again.
- Only tracked UUID WebP objects under the private `profile-photos/` namespace
  are eligible. No bucket sweep, account reset, financial deletion, or message
  deletion is performed. Untracked files and other namespaces are untouched.
- The existing API service logs a dry-run report before each cleanup, at startup
  and hourly while running. Each pass selects at most 25 objects, skips locked
  accounts, works sequentially, and starts no more work after a 60-second budget.
  Each storage deletion has a 10-second wait limit; a timed-out request may finish
  later, but its committed marker still prevents unsafe saves. Passes never overlap
  within a process; database locks and markers coordinate multiple instances.
  Database statements have a five-second timeout.
  Stopped/idle API instances do not run jobs; cleanup resumes at the next startup.
- Permanent deletion cannot be reversed through a code rollback. To pause cleanup,
  set `PROFILE_PHOTO_CLEANUP_MODE=dry-run` on the API service and restart it,
  leaving schema and files intact. Reports continue, but deletion stops. Existing
  markers must remain enforced until deletion is safely resolved.

Read-only operator report (counts, bytes, and a sample of at most 25 IDs):

    pnpm --filter @workspace/api-server run photos:retention-report

There is no public cleanup endpoint. Reporting is safe without deletion approval;
the scheduler's destructive mode uses the approved 30-day policy above.

Apply the additive retention migration **before starting this API version** in
each environment (development applied; production not applied by this task):

    pnpm --filter @workspace/api-server exec esbuild src/scripts/profile-photo-retention-migrate.ts --bundle --platform=node --format=esm --banner:js="import { createRequire as cr } from 'node:module'; const require=cr(import.meta.url);" --outfile=.tests/profile-photo-retention-migrate.mjs
    node artifacts/api-server/.tests/profile-photo-retention-migrate.mjs

The existing post-merge schema push includes these additive columns/index.

Retention verification uses real PostgreSQL and App Storage with destructive
cleanup restricted to generated synthetic IDs: dry-run does not delete, current
and recent photos survive, replacements/removals get a new clock, concurrent saves
are protected, interrupted/missing-object retries are safe, invalid keys are
rejected, empty scopes cannot delete anything, and each batch stops at 25.
Original profile rows, message/ledger counts, and current photo bytes are compared
before and after. Run `pnpm --filter @workspace/api-server run test:photo-retention`.

App Storage billing covers stored bytes, transfer and operations. No external AI
classifier or photo-analysis service is enabled. University atmosphere remains
activity-based; final background clips remain placeholders.

## Additive migration and rollback

`scripts/profile-setup-migration.sql` adds nullable `display_name`, nullable
`photo_url`, and `profile_photos` with an owner/time index. No DROP/reset, credential
changes or identity backfill. Development migration applied; production not applied.

From the workspace root:

    pnpm --filter @workspace/api-server exec esbuild src/scripts/profile-setup-migrate.ts --bundle --platform=node --format=esm --banner:js="import { createRequire as cr } from 'node:module'; const require=cr(import.meta.url);" --outfile=.tests/profile-setup-migrate.mjs
    node artifacts/api-server/.tests/profile-setup-migrate.mjs

Use the project checkpoint for code rollback. Keep additive columns and stored
files intact; rolling back code must not erase newly saved profiles/photos/history.

## Verification completed

- OpenAPI codegen and workspace typecheck passed.
- Frontend production build passed (PORT=24150, BASE_PATH=/).
- Managed API/frontend workflows restarted and served cleanly.
- Backend: 44 passing checks across `test:photos` (2), `test:profiles` (6),
  `test:community` (3), `test:chat` (1), `test:social` (7) and archived compatibility
  `test:rooms` (25).
- Real App Storage + PostgreSQL + HTTP photo integration verified valid upload,
  streaming persisted bytes, metadata removal, staged privacy, cross-account
  photo rejection, replacement/removal persistence, updated historical chat
  photo references, university isolation, and unchanged photos after 😂/😡/😭.
- Profile tests used real PostgreSQL and trusted middleware auth fixtures:
  incomplete setup, invalid saves, returning legacy profiles, same-record edits,
  duplicate saves, cross-account and cross-origin rejection.
- Atmosphere thresholds/isolation remain tested; no sentiment service was enabled.
- Public mobile screenshot confirms six ordered university labels, sign-in/signup
  links, retained styling and non-affiliation disclaimer.

These server fixtures are **not proof of real Clerk signup/password sign-in**.

### Browser pass: actual results

One unique synthetic Clerk account authenticated against `/api/me` and
`/api/account/chat/access` (both 200), without editing original accounts:

- Default custom email signup showed password-mismatch validation. No valid
  email signup was submitted.
- Direct LiveMe navigation required adult confirmation/profile setup.
  Empty fields did not advance; refresh resumed incomplete setup.
- Valid handle/name/bio without a photo saved and opened Directory automatically.
- Uploading, replacing and removing synthetic PNG photos persisted after saves
  and reloads. Removal showed neutral initials. Final reupload persisted.
- LiveMe and Bigo tabs displayed the same saved profile photo; LiveMe-only messages
  and facial emojis persisted after reload and never appeared in Bigo. The photo
  did not change.
- The social profile displayed the same photo/bio. Mobile editor and Directory
  had no horizontal overflow at 390x844, with all six universities/disclosure.
- Sign-out followed by supported-helper sign-in returned straight to Directory
  with the same saved profile and photo.
- No camera permission prompt appeared, and active code has no microphone request.

Limits: no valid real email signup/email verification or human existing-account
password login was performed. Supported-helper sign-in is not equivalent to those
flows. Photos/messages created by this pass belong only to the synthetic fixture.
Before public launch, verify production Clerk configuration and real email/password
sign-in, apply the additive migration to production, and set moderation/age policy.
The existing age protection is self-declared 18+, not independent age verification.

## Files changed

- Frontend: `src/App.tsx`, `src/chat/ChatApp.tsx`, `chat.css`, `useTextRoom.ts`,
  `src/components/email-signup.tsx`, `user-photo.tsx`, `src/lib/errors.ts`,
  and active `src/social/{common,PeoplePages,SocialApp}.tsx`.
- API: `src/app.ts`, `src/routes/{index,identity,profile-photos,community,chat,rooms}.ts`,
  `src/lib/{account-profiles,profile-photo-storage,community,room-store,room-chat}.ts`,
  `src/lib/social/core.ts`, and profile/chat/community/photo tests.
- Shared: account profile/photo schema and exports, OpenAPI/social contracts,
  regenerated React/Zod clients, migration SQL/runner, API package/lockfile.
- Project guidance: `replit.md` and archived-avatar memory clarification.
