#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push
# Schema synchronization alone cannot backfill existing main photos or establish
# retention defaults. These additive migrations are safe to rerun.
pnpm --filter @workspace/api-server exec esbuild src/scripts/profile-setup-migrate.ts src/scripts/profile-photo-retention-migrate.ts \
  --bundle --platform=node --format=esm \
  --banner:js="import { createRequire as cr } from 'node:module'; const require=cr(import.meta.url);" \
  --outdir=.tests/migrations --out-extension:.js=.mjs
node artifacts/api-server/.tests/migrations/profile-setup-migrate.mjs
node artifacts/api-server/.tests/migrations/profile-photo-retention-migrate.mjs
