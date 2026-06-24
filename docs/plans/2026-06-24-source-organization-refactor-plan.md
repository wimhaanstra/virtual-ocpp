# Source Organization Refactor Plan

## Problem

The project is now large enough that `apps/server/src` and `apps/web/src` are harder to scan than they should be for an open-source project. Tests have been moved into app-level `tests` folders, but production source still has a few large files and broad route modules that mix multiple responsibilities.

## Goals

- Make backend and frontend source folders easier for new contributors to navigate.
- Reduce large-file pressure without changing runtime behavior.
- Keep each refactor slice reviewable and backed by focused tests.
- Preserve current API contracts, OCPP behavior, database schema, and UI behavior unless a later feature slice explicitly changes them.

## Non-Goals

- Do not redesign OCPP behavior.
- Do not introduce a new framework, state manager, or routing library.
- Do not rename public API routes in these cleanup slices.
- Do not combine source reshaping with schema migrations or feature work.

## Recommended Slices

### 1. Backend Route Module Split

`apps/server/src/visibility.ts` now owns sessions, logs, meter gaps, proxy stop recovery, active-session audit, and charger command routes. Split it into focused route modules while keeping the same exported registration surface:

- `session-routes.ts`
- `meter-gap-routes.ts`
- `log-routes.ts`
- `charger-command-routes.ts`
- shared visibility helpers under `visibility/` or `routes/support/`

Acceptance criteria:

- Existing routes keep the same paths and response shapes.
- Current visibility/session/meter-gap tests pass without major assertion rewrites.
- Shared helpers are private to the backend and not over-abstracted.

### 2. Backend OCPP Domain Split

Keep OCPP transport code separate from session/meter persistence logic:

- keep websocket/RPC registration in `ocpp/server.ts`
- keep command sending in `ocpp/charger-command-service.ts`
- extract meter sample normalization from `ocpp/handlers.ts`
- extract session recovery/replacement helpers from `ocpp/repository.ts` only if it reduces file size without hiding SQL behavior

Acceptance criteria:

- OCPP tests remain the primary regression suite.
- No change to proxy forwarding, transaction mapping, or authorization decisions.
- Normalization helpers get direct unit tests if extracted.

### 3. Frontend API Client Extraction

`apps/web/src/App.tsx` still owns many fetch helpers. Extract typed API functions into `apps/web/src/api/`:

- `api/client.ts` for common fetch/error handling
- `api/chargers.ts`
- `api/sessions.ts`
- `api/proxy-targets.ts`
- `api/communication.ts`
- `api/settings.ts`

Acceptance criteria:

- Components keep receiving data and callbacks through existing props.
- Unauthorized handling remains centralized and unchanged.
- `App.test.tsx` still covers user workflows rather than implementation details.

### 4. Frontend State Hook Extraction

After the API client exists, move related state clusters out of `App.tsx` into hooks:

- `useChargerData`
- `useCommunicationJournal`
- `useSessions`
- `useOnboarding`
- `useProxyTargets`

Acceptance criteria:

- No new global state library.
- Hooks are grouped by existing UI/domain boundaries.
- Component props become smaller where practical, but views remain mostly unchanged.

### 5. Frontend Test Split

`apps/web/tests/App.test.tsx` is broad and valuable, but it should not be the only test file. Split high-traffic workflows into focused test files after API/hook extraction:

- `dashboard.test.tsx`
- `sessions.test.tsx`
- `proxy-targets.test.tsx`
- `onboarding.test.tsx`
- `communication.test.tsx`

Acceptance criteria:

- Test helper setup avoids duplicating large fetch mocks.
- Existing workflow coverage is preserved.
- The total test suite remains understandable from file names.

## Suggested Order

1. Backend route module split.
2. Frontend API client extraction.
3. Frontend state hook extraction.
4. Backend OCPP domain split.
5. Frontend test split.

This order reduces risk by moving route/API boundaries first, then simplifying state and domain internals once tests still cover the same behavior.
