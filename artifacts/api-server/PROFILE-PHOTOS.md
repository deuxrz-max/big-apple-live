# Three saved profile photos

Each profile can keep zero to three saved photos. A nonempty collection has one
main photo, used wherever a single profile photo is displayed. The profile viewer
also shows the other saved photos. Chat messages remain names only.

Edit Profile supports adding photos, choosing the main photo, replacing any photo
at the three-photo limit, and removing photos. Removing the main photo selects the
first remaining one; removing all photos restores neutral initials. Changes apply
when the profile form is saved. A fourth selected photo is rejected on the server,
even if someone bypasses the disabled Add button.

This is not a lifetime upload limit. Temporary staged and replaced uploads retain
the existing 30-day-unused cleanup policy. Cleanup and authenticated image serving
now recognize every selected gallery photo, not only the main photo. Removed photos
receive a fresh unused timestamp; currently selected photos remain protected.
Existing validation, account ownership, image metadata removal and block checks
remain in place.

## Additive development migrations

`scripts/profile-setup-migration.sql` adds `account_profiles.photo_urls` with a
three-item database constraint, and copies the existing main photo into the new
collection without changing it. Profile/message/ledger counts were unchanged.

The merged retention feature's missing `unused_since` and `deletion_started_at`
columns were also applied using its existing additive migration. No original user
files or account/message/financial data were deleted by these migrations.
`scripts/post-merge.sh` runs both idempotent migrations after schema synchronization
so future merges preserve the backfill and retention defaults.

Production migrations/publishing were not performed.

## Verification

- OpenAPI generation, workspace typecheck and frontend production build passed.
- 13 backend checks passed across photo (2), profile (6), retention (1), community
  (3) and chat (1) suites.
- Real HTTP + PostgreSQL + App Storage checks cover three-photo persistence,
  main selection, fourth-photo rejection, duplicate/foreign-photo rejection,
  replacement/removal, protected secondary images and the existing unused grace.
- A focused browser pass using the same synthetic account verified three distinct
  saved photos, main selection surviving refresh, the disabled Add button at 3/3,
  server rejection of four photos without changing the collection, replacement at
  the limit, removal/refill, and the public profile's main-plus-two display.
- The three-card editor fit at 390x844 without horizontal overflow; main selection
  controls had accessible labels. No original-user photos were edited.
