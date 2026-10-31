# Dependency security remediation

Date: October 31, 2026.

## Before-change rollback point

- Git reference: `refs/rollbacks/before-dependency-security-20261031T171607Z`
- Commit: `9e375aaed7c149d0e84160c72d5f7b67d05e551b`
- Captures tracked and unignored project files only. Does not independently capture database contents, secrets, ignored uploads, cloud media, external LFS storage, or deployment state.

## Results

All 25 assigned dependency findings are absent after remediation.

- Replit dependency audit: 0 critical, 0 high, 0 moderate, 0 low.
- `pnpm audit --json`: 0 vulnerabilities.
- These results concern known dependency advisories, not a full application security certification. No SAST or privacy/dataflow scan was requested or run.

## Changes

| Dependency | Previously | Resolved version / action |
| --- | --- | --- |
| proxy-addr | 2.0.7 | 2.0.8 |
| body-parser | 2.3.0 | 2.4.0 |
| vite | 7.3.6 | 7.3.7 |
| source-map-js | 1.2.1 | 1.2.2 |
| brace-expansion | 5.0.9 | Removed from dependency graph by upstream updates |
| markdown-it | 14.3.1 | Removed from dependency graph by upstream updates |
| zod | 3.25.76 | 4.6.7 |
| multer | 2.4.0 | 2.5.0 |
| uuid | 9.0.1 | Removed from dependency graph by upstream updates |
| qs | 6.16.0 | 6.17.1 |
| minimatch | 10.2.6 | Removed from dependency graph by upstream updates |
| fast-uri | 3.1.7 | 3.1.9 |
| postcss-selector-parser | 6.0.10 | 6.1.5 |

Updated direct parents Express to 5.3.0, Google Cloud Storage to 8.4.0, and Orval to 8.46.0. Refreshed compatible transitive packages. The latest Tailwind typography package still pins postcss-selector-parser 6.0.10, so a parent-scoped override selects patched 6.1.5 without changing unrelated parser consumers.

Zod required a major update. Regenerated validators and client code from the existing OpenAPI contract with explicit Zod 4 / React Query 5 output settings. Generator cleanup removed obsolete duplicate generated type files. No handwritten UI, game, payment, or business-policy logic was changed.

## Verification performed

- `pnpm run typecheck`: all workspace packages pass.
- OpenAPI code generation completes successfully.
- Production builds for API, web app, and component sandbox pass using explicit service environment values. An initial root build without PORT failed because the sandbox requires that variable; the correctly configured build passed.
- 18 tests passed across:
  - dependency security: 3;
  - GCS response streaming: 3;
  - room title validation: 3;
  - audio-only room policy: 3;
  - gifting levels: 6.
- New security regressions cover generated validator limits, oversized constrained-array issue bounds, valid and malformed compressed request bodies, and successful/malformed multipart uploads while the server remains available.
- API, web app and component sandbox workflows restarted once after the coherent update and reported RUNNING.
- API `/api/healthz`: HTTP 200.
- Signed-out preview inspected at 390×844: page renders, with no fatal startup error. This was not signed-in, Android hardware, camera, PK, or end-to-end gifting verification.
- No publishing, database migration, payment enablement or card-game-switch changes performed.

## Non-blocking observations

The install retains an unrelated LiveKit recording-type peer warning, and the build retains large-chunk warnings. The browser reports existing Clerk development-key/CSS warnings and unavailable WebGPU support. These are not the 25 assigned dependency advisories and were not changed in this focused remediation.
