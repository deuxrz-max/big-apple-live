---
name: Safe preview schema pushes
description: Existing Passport constraint drift can make a general Drizzle push propose truncating preview data.
---

When adding development schema, inspect the full proposed change. A general Drizzle push encountered an unrelated uniqueness mismatch on the existing Streamer Passport links table and requested truncating two rows. Do not force that prompt or alter those rows as part of an unrelated feature.

The development Gift Studio table also had both a Drizzle-generated `gift_studio_assets_gift_id_check` and a separately named `gift_studio_gift_id_check`. When widening accepted IDs, inspect `pg_constraint` and remove both old checks before adding the replacement; dropping only the manually named check still rejects custom `studio-<UUID>` IDs.

**Why:** the repository schema and the current development database can drift independently, and a broad schema push may turn that mismatch into a destructive prompt.

**How to apply:** preserve existing data; stop any push that requests truncation, then use the approved database workflow for only the authorized additive change. For Gift Studio ID constraints, verify the live constraints by name before and after the targeted DDL.
