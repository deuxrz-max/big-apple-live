# Four saved profile photos

Each profile can keep zero to four saved photos. A nonempty collection has one
main photo, used wherever a single profile photo is displayed. The profile viewer
also shows all saved photos: the main photo and up to three additional photos.
Chat messages remain names only.

Edit Profile has a "+ Click to add" upload control and a two-column photo grid.
It supports choosing the main photo, replacing any photo
at the four-photo limit, and removing photos. Removing the main photo selects the
first remaining one; removing all photos restores neutral initials. Changes apply
when the profile form is saved. A fifth selected photo is rejected on the server,
even if someone bypasses the disabled Add button.

This is not a lifetime upload limit. Temporary staged and replaced uploads retain
the existing 30-day-unused cleanup policy. Cleanup and authenticated image serving
now recognize every selected gallery photo, not only the main photo. Removed photos
receive a fresh unused timestamp; currently selected photos remain protected.
Existing validation, account ownership, image metadata removal and block checks
remain in place.

## Additive development migrations

`scripts/profile-setup-migration.sql` adds `account_profiles.photo_urls` with a
four-item database constraint, and copies the existing main photo into the new
collection without changing it. The old three-item constraint is replaced in the
same transaction without changing existing collections. Profile/message/ledger
counts were unchanged: 17 profiles, 35 messages and 5 ledger entries before/after.

The merged retention feature's missing `unused_since` and `deletion_started_at`
columns were also applied using its existing additive migration. No original user
files or account/message/financial data were deleted by these migrations.
`scripts/post-merge.sh` runs both idempotent migrations after schema synchronization
so future merges preserve the backfill and retention defaults.

Production migrations/publishing were not performed.

## Verification

- OpenAPI generation, workspace typecheck and frontend production build passed.
- 8 backend checks passed for the four-photo update: photo (2) and profile (6).
- Real HTTP + PostgreSQL + App Storage checks cover four-photo persistence,
  main selection, fifth-photo rejection, duplicate/foreign-photo rejection,
  replacement/removal, protected secondary images and the existing unused grace.
- The earlier three-photo browser pass verified main selection, replacement,
  removal/refill and refresh persistence.
- The focused four-photo browser pass used the same synthetic account: the
  "+ Click to add" button opened a real file chooser, a fourth photo saved and
  survived reload, and the old three photos and main selection were unchanged.
  At 390x844, the editor displayed all four in a 2x2 grid and the public profile
  displayed its main plus three additional photos without horizontal overflow.
  The fixed bottom navigation did not cover the visible profile control.
