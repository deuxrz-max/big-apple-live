---
name: Artifact command environment
description: Distinguish managed workflow environment from ad-hoc shell verification.
---

Managed artifact runtime variables are scoped to the service workflow; an
ad-hoc shell build may not inherit them even when preview works.

One-off Node scripts that import workspace database or server packages also
need a module format and dependency-resolution context compatible with their
CommonJS dependencies. An ESM bundle can fail on dynamic built-in requires, and
external packages may not resolve from a temporary output directory.

**Why:** One-off builds failed for missing service routing variables while
managed preview worked, and a standalone database script failed when its
bundle format and output location did not match package resolution.

**How to apply:** Inspect the existing artifact/run configuration and reproduce
its non-secret routing context for the one-off command. Do not change a working
manifest, hardcode a new port, or request credentials in response to a shell-only
missing-variable failure.

For one-off package scripts, run in the owning package context and keep the
output format compatible with the imported dependencies; do not assume ESM
bundling resolves package-local CommonJS modules.

Commands run through `pnpm --filter <package> exec` resolve relative paths from
that package directory. If a shell chain then invokes a tool from the workspace
root, qualify generated-file paths from the root rather than reusing package-
relative paths.

**Why:** A filtered bundle command succeeded, but its following Node test command
could not locate the output because the two commands resolved paths from
different working directories.

**How to apply:** Check each chained command's working directory when running
filtered test or build commands, especially when output is relative to the
package but the next command is launched by the outer shell.
