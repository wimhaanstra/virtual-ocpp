# Development

## Current Scope

Virtual OCPP currently includes:

- npm workspaces for `apps/server` and `apps/web`
- Fastify backend with auth, health, settings, charger, tag, proxy target, session, communication, and live-update routes
- SQLite/Drizzle persistence and migrations
- Vite React frontend with protected admin pages
- OCPP 1.6j websocket endpoint at `/ocpp/:chargerId`
- repo-local charger simulator for demos and smoke tests
- live SSE updates for admin UI invalidation
- production Docker image that serves the backend and frontend from one container

## Local Run

```sh
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

Use separate terminals when you want split logs:

```sh
npm run dev:server
npm run dev:web
```

## Frontend Routes

The protected frontend uses client-side routes:

- `/` global dashboard
- `/charger-dashboard` selected charger dashboard
- `/chargers` charger registry and delete flow
- `/tags` global tag identities
- `/tag-access` charger-scoped tag grants for the selected charger
- `/proxy-targets` charger-scoped proxy targets
- `/sessions` charging sessions and force-close review
- `/communication` redacted OCPP communication journal
- `/settings` onboarding state and manual onboarding rerun

The selected charger context is stored in `?chargerId=...`, so refresh and back/forward keep the current charger. Vite handles local deep links during development, and the production Fastify server serves the same SPA fallback.

## Settings And Onboarding

The Settings page is the operator entry point for onboarding state:

- `GET /api/settings/onboarding` returns `{ completed, completedAt, skippedAt }`.
- `PATCH /api/settings/onboarding` accepts exactly one action: `{ "completed": true }`, `{ "skipped": true }`, or `{ "reset": true }`.

Onboarding state is stored in SQLite. When neither `completedAt` nor `skippedAt` is set, the frontend automatically opens the onboarding wizard after admin login.

The first-run onboarding flow is presented as a multi-step wizard. It can:

- wait for the next newly registered charger
- create or select a tag
- grant that tag access to the detected charger
- optionally create one charger-scoped proxy target
- mark onboarding completed only after the selected setup steps succeed

Closing the first-run wizard before completion marks onboarding as skipped. The Settings page has a manual `Run onboarding` action that opens the same flow without changing stored state unless the operator completes or skips it again.

The normal `Add charger` flow on the Chargers page is separate. It only captures charger registration and label changes; it does not create tags, grant access, or update onboarding state.

## Tags And Proxy Targets

Tags are global records in SQLite, but each charger needs an explicit grant before a tag can authorize charging:

- enabled tag with enabled charger access: accepted
- disabled tag: rejected
- unknown tag: rejected
- enabled tag without charger access: rejected

Proxy targets are charger-scoped. Each charger can have at most three enabled proxy targets, while disabled targets can remain configured for later. A target can be `monitor-only` or `deny-capable`, and can use `fail-open` or `fail-closed` outage handling.

Current proxy behavior:

- deny-capable targets are consulted only after local tag access is accepted
- mirrored calls go to `BootNotification`, `Heartbeat`, `Authorize`, `StartTransaction`, `StatusNotification`, `MeterValues`, and `StopTransaction` in deterministic oldest-first target order
- outbound tag mappings only affect the mirrored `Authorize` and `StartTransaction` payloads
- one outbound websocket connection is kept per charger/target pair and is warmed when a charger connects
- connection failures trigger in-memory reconnect backoff and are reflected in proxy health with retry timing, latest error code, and reconnect failure count

`DELETE /api/chargers/:id` is implemented. It requires the admin password plus exact charger id confirmation and removes charger-owned runtime state and linked proxy data.

## Sessions, Meter Gaps, And Live Updates

The charger dashboard and sessions page show:

- charger connection state and silence warnings
- live charging stats from `MeterValues`
- runtime proxy health
- active-session audit warnings for likely missing `StopTransaction`
- meter-gap review and recovery previews
- `StopTransaction` recovery for Smart EVSE `transactionId = -1` when the replay can be matched unambiguously
- manual proxy `StopTransaction` recovery for already-stopped local sessions when an upstream transaction id was created but never mapped locally

If the charger has not sent a `MeterValues` yet, the UI keeps the active card in `Charging` and shows the session as waiting for the first sample.

Stopped sessions use the final `StopTransaction` meter value as the exact energy total when available. Active sessions and recovery previews label latest-sample or start-meter fallbacks so operators can tell estimated values from exact stopped-session totals.

The frontend opens `GET /api/live-updates` with `EventSource` after login. The stream uses the signed admin session cookie, replays missed events after reconnect, and tells the UI which REST slices to refresh.

## Communication Journal

The protected communication journal stores redacted protocol traces for charger, proxy, and server traffic.

- `GET /api/communication-journal` returns filtered rows.
- `GET /api/communication-journal/export` downloads the filtered redacted rows as CSV.
- `POST /api/communication-journal/purge` deletes rows older than the configured retention window, or rows matching an explicit filter scope when the operator confirms with `PURGE`.

Secret-like fields are redacted before storage. Exports use the same redacted public journal rows and are meant for operator troubleshooting, not for raw payload archives.

## Simulator

Run the repo-local OCPP charger simulator from the root:

```sh
npm run simulator -- --charger-id SIM-001 --tag-id SIM-TAG-001 --ensure-tag
```

The simulator uses `ocpp-rpc` as a charger client and sends a full session flow through the real websocket endpoint. `--ensure-tag` creates or enables the configured tag and grants it access to the simulator charger after the charger has connected.

Use `--run-time=15m --power-kw=11` for a timed 11 kW session. `--keep-open` leaves the simulator connected after the demo session. Run `npm run simulator -- --help` for the full CLI.

For a fast local smoke flow against a running server:

```sh
ADMIN_PASSWORD=correct-password npm run smoke:simulator
```

The smoke flow uses `SMOKE-001` and `SMOKE-TAG-001`, ensures tag access, sends a short accepted transaction, emits two meter samples, and exits after `StopTransaction`.

## Testing

```sh
npm test
npm run build
```

The OCPP integration tests use fake chargers and local websocket ports, so they may need normal localhost networking permission in sandboxed environments.

## Database

SQLite lives at `./data/virtual-ocpp.sqlite` by default. The `data` directory is ignored by git and becomes the Docker volume mount point in deployment.
