---
name: Persistent preview test account boundaries
description: Owner-requested inspection accounts are not disposable regression fixtures or production seeds.
---

The owner requested persistent, sign-in-capable preview test accounts and sample
conversations to inspect personally. Keep these distinct from temporary regression
fixtures. Never seed them automatically during startup or publishing.

Keep all preview test accounts and their data until the owner explicitly asks for
their removal. Do not clean them up based on age, inactivity, or task completion.

For explicitly requested preview-account cleanup, select only profiles carrying
the test marker, preview exact related records and counts, and require a
confirmation bound to that preview. Refuse cleanup when it would remove messages
or relationship records involving unmarked accounts; preserve historical records
that can safely be detached from the test profile.

**Why:** These accounts are intended for the owner to look around the app, and
their messages to the owner's real preview account must remain unread until the
owner opens them. They are development-only test data, not real broadcasters;
mixed test/real-account records can contain real-user data.

**How to apply:** Regression tests should create and clean up their own isolated
fixtures, not bulk-delete accounts based on a test-like display name. Remove
persistent preview accounts only after an explicit owner request. For that cleanup,
use the profile's test marker, preview the exact records, and block deletion that
would affect unmarked accounts. Do not sign in as the owner or open the owner's
sample conversations merely to verify delivery; use read-only counts instead.

**Why:** The owner explicitly said to keep the test accounts until they ask for
removal.

**How to apply:** Remove the persistent preview accounts only after an explicit
owner request; routine cleanup applies only to isolated regression fixtures.

For Replit-managed Clerk, existing passwords cannot be read back for comparison.
For explicitly authorized development test accounts, set the password through
Clerk's development user-update API rather than trying to inspect it. A correct
password in a fresh browser may still stop at the new-device email check; that
is not a completed sign-in. Never bypass or inspect the verification code.

**Why:** The preview's first browser was treated as a new device, and Clerk
required email verification after the password was accepted.

**How to apply:** Verify account identity from the development profile records,
update only the requested test users, and treat the email-check screen as
partially authenticated rather than signed in.
