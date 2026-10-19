---
name: Gift send ordering
description: Ordering guarantees and the scaling limit for room and livestream gift delivery.
---

Gift sends are serialized per room or stream inside the running API process, and room receipts use a monotonic database sequence for cursor paging.

**Why:** A per-process queue keeps accepted gift events in order in the current single-service preview, but it cannot order concurrent sends handled by different API instances.

**How to apply:** Before running multiple API instances or promising live gift recovery across server restarts, move ordering and delivery to a database-backed lock/outbox or another shared durable queue.
