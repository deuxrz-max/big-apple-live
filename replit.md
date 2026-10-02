# Room Chat Backend

Backend-only room creation, joining, active participant sessions, and live room-state events.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Room session features require no database or external service.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract
- `artifacts/api-server/src/lib/room-store.ts` — room/session state
- `artifacts/api-server/src/routes/rooms.ts` — REST and server-sent events
- `artifacts/api-server/ROOMS.md` — lifecycle, API usage, and limitations

## Architecture decisions

- Presence is deliberately ephemeral and single-process for this initial framework.
  This avoids treating database rows as evidence of a currently active user.
- Heartbeat leases are used instead of treating event-stream connections as identity;
  observing a room must not create or preserve a participant session.
- Public participant IDs differ from private session credentials.

## Product

Users can create a room with a unique shareable ID, join by ID, keep an active
participant session, leave, and subscribe to live participant snapshots.

## User preferences

No audio routing or UI elements yet. Focus entirely on session management and room state.

## Gotchas

- Restarting the API clears rooms and participant sessions.
- Multiple API instances require shared state and pub/sub first.
- Regenerate API types after OpenAPI changes.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
