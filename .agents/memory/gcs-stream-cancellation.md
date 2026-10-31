---
name: Canceled GCS media requests
description: Why browser disconnects must not destroy pending Google Cloud Storage read streams.
---

Do not destroy a pending GCS read stream when its browser response closes. Detach the response and drain the source, keeping an error listener attached.

**Why:** The installed GCS client can receive its upstream response after the downstream PassThrough has been destroyed, throwing ERR_STREAM_UNABLE_TO_PIPE outside Express and terminating the API. A request-level Express error handler alone cannot intercept that library callback race.

**How to apply:** Route GCS-backed media responses through the shared safe streaming helper. Keep cancellation, source-error and healthy-response tests together. Draining may continue downloading the requested object or range after the client leaves; reducing that bandwidth requires a separately verified upstream cancellation mechanism, not restoring downstream destroy-on-close behavior. Do not hide arbitrary process-level exceptions with a blanket continue-running handler.
