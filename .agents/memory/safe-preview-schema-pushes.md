---
name: Safe preview schema pushes
description: Existing Passport constraint drift can make a general Drizzle push propose truncating preview data.
---

When adding development schema, inspect the full proposed change. A general Drizzle push encountered an unrelated uniqueness mismatch on the existing Streamer Passport links table and requested truncating two rows. Do not force that prompt or alter those rows as part of an unrelated feature.

**Why:** the repository schema and the current development database can drift independently, and a broad schema push may turn that mismatch into a destructive prompt.

**How to apply:** preserve existing data; stop any push that requests truncation, then use the approved database workflow for only the authorized additive change.
