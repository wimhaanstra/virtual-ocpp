# Development

## Slice 1.1 Scope

The current implementation creates the foundation and initial OCPP local-primary server:

- npm workspace with `apps/server` and `apps/web`
- Fastify backend with health and local admin auth routes
- SQLite/Drizzle migration baseline
- Vite React frontend shell with shadcn/ui-compatible structure
- Vitest smoke tests
- OCPP 1.6j websocket endpoint at `/ocpp/:chargerId`
- Fake OCPP client integration tests for boot, heartbeat, auth, transaction, status, and meter flows
- Protected tag CRUD APIs
- Frontend login with the interface hidden until authentication
- Protected proxy target CRUD APIs
- Deny-capable proxy authorization checks for `Authorize` and `StartTransaction`
- Per-target fail-open and fail-closed outage policy
- Outbound OCPP mirroring for supported charger calls
- Per-target external transaction id mapping for mirrored sessions
- Protected operator visibility APIs for charger connections, sessions, and logs
- Protected home dashboard as the default admin view, showing OCPP connection info, protocol/auth requirements without secrets, charger connection status, summary metrics, and quick links
- Protected communication journal API/page with redacted charger/server/proxy protocol payloads, source/target filtering, and configurable automatic purge
- Protected charger registry and charger context selector
- Charger-scoped proxy targets so each local charger chooses which upstreams it mirrors to
- Global tags with explicit per-charger access controls
- Frontend tag, proxy target, sessions, activity, home dashboard, and communication pages as the active admin pages

Per-proxy tag mapping and persistent upstream connection pooling are intentionally not part of this slice.

## Local Run

```sh
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

Use `npm run dev:server` and `npm run dev:web` in separate terminals when you want clearer logs.

The server loads `.env` automatically from the current directory, parent directory, or grandparent directory before validating config. That covers running npm scripts from the repo root and running server commands from `apps/server`.

The Vite frontend uses client-side routes for the protected admin pages:

- `/`: home dashboard
- `/proxy-targets`: charger-scoped proxy targets
- `/tags`: global tags with selected-charger access controls
- `/sessions`: charging sessions
- `/activity`: charger connection history and logs
- `/communication`: redacted OCPP communication journal

The selected charger context is stored in `?chargerId=...`, so refresh and browser back/forward preserve the active page and charger. Vite handles local development fallback for these routes; a later production static hosting slice must serve the same single-page app fallback for deep links.

## Testing

```sh
npm test
npm run build
```

Tests should stay focused on the changed behavior for each slice. Future OCPP tests should use fake OCPP clients and external backend stubs rather than live charger hardware.

The OCPP integration tests bind a local ephemeral port. In sandboxed environments they may need approval to run with normal localhost networking permissions.

## Tag Workflow

Tags are stored globally in SQLite, but each charger must be granted explicit access to a tag before that tag can authorize charging during `Authorize` or `StartTransaction`:

- enabled tag with enabled access for the charger: accepted
- disabled tag: rejected
- unknown tag: rejected
- enabled tag without charger access: rejected

The tag API and frontend tag page are protected by the local admin session cookie. Frontend requests use same-origin `/api/*` paths; Vite proxies those to the backend during local development.

Newly created tags grant access to no chargers by default. Use the selected charger context in the frontend, or `PUT /api/tags/:id/chargers/:chargerId`, to grant access.

## Proxy Target Workflow

Proxy targets are managed through the frontend and stored in SQLite. There is no hard-coded target limit. A proxy target is scoped directly to one charger and does not receive traffic from other chargers.

Target fields:

- `name`: operator-facing label.
- `url`: external OCPP WebSocket URL.
- `username`: optional upstream credential field, masked in API responses.
- `chargerId`: local charger id from `/ocpp/:chargerId`.
- `stationId`: optional upstream OCPP identity for this charger and target. When blank, the local charger id is used.
- `enabled`: disabled targets are ignored.
- `mode`: `monitor-only` or `deny-capable`.
- `outagePolicy`: `fail-open` or `fail-closed`.
- `basicAuthPassword`: optional outbound Basic Auth password, masked in API responses.

During `Authorize` and `StartTransaction`, Virtual OCPP first checks the global tag and charger-specific access. If the tag is locally rejected, proxy targets are not consulted. If the tag is locally accepted, enabled `deny-capable` targets for that charger are called in order. Any non-`Accepted` proxy response rejects the local operation.

Unavailable deny-capable targets follow their configured outage policy. `fail-open` keeps the local allow decision; `fail-closed` rejects the operation until the target is reachable again. `monitor-only` targets receive mirrored calls but do not affect local charger decisions.

Mirrored calls are sent to each enabled proxy target for the active charger:

- `BootNotification`
- `Heartbeat`
- `Authorize`
- `StartTransaction`
- `StatusNotification`
- `MeterValues`
- `StopTransaction`

Each mirrored call currently opens an outbound OCPP client connection, sends the call, records a log entry, and closes the connection. If target `stationId` is configured, it is used as the upstream OCPP identity; otherwise the local charger id is used. When a proxy target returns a transaction id from `StartTransaction`, the server stores it in `proxy_session_mappings`. Later `MeterValues` and `StopTransaction` calls for the local transaction are sent to that target with the mapped external transaction id.

## Home Dashboard Workflow

The protected default admin view is the home dashboard. It is read-only and gives operators the first-screen charger overview:

- local OCPP connection URL
- expected websocket protocol
- optional Basic Auth requirement without exposing secrets
- charger connection status and recent activity summary
- quick links to sessions, activity, tags, and proxy targets

The dashboard reads this setup information from `GET /api/dashboard-config`. That protected endpoint returns the charger URL template, the OCPP websocket subprotocol, and whether charger Basic Auth is required. It never returns the Basic Auth password. By default the displayed URL uses the backend `PORT`; set `OCPP_PUBLIC_URL` when the charger should connect through a reverse proxy or TLS hostname.

## Communication Journal Workflow

The protected Communication page shows full redacted OCPP protocol traces for troubleshooting:

- charger to server calls
- server to charger results and errors
- server to proxy calls
- proxy to server results and errors
- charger connection and disconnect events

Communication rows are stored separately from the operational `logs` table in `communication_journal`. Payloads keep normal OCPP fields such as tag ids, meter values, station ids, connector ids, transaction ids, and status values. Secret-like fields such as passwords, tokens, authorization headers, cookies, and credentials are recursively redacted before storage.

The journal API is protected by the admin session:

- `GET /api/communication-journal` returns recent rows, newest first, with filters for source, target, charger, proxy target, method, message type, and time range.
- `POST /api/communication-journal/purge` deletes rows older than the configured retention window.

Retention is configured with `COMMUNICATION_LOG_RETENTION_HOURS`, defaulting to `24`. The server purges expired rows on startup and also after inserts with an in-memory throttle so cleanup does not run on every OCPP message.

## Operator Visibility Workflow

The authenticated frontend exposes read-only operational views for sessions and activity:

- `GET /api/sessions` returns recent charging sessions.
- `GET /api/chargers` and `GET /api/charger-connections` return recent charger connection records.
- `GET /api/logs` returns recent logs with `hasMetadata` and a whitelisted context subset, but never raw metadata.

The sessions page shows charger id, connector, transaction id, tag id, status, timestamps, meter readings, and stop reason. The activity page shows charger connection history and recent log messages. For logs, only safe context fields such as `proxyTargetId`, `method`, and `status` are exposed. This slice uses manual refresh buttons; live updates are deferred.

## Database

The app uses SQLite through Drizzle. By default the database lives at:

```text
./data/virtual-ocpp.sqlite
```

The `data` directory is ignored by git and should become the Docker volume mount point in the deployment milestone.

The current migration script creates the baseline schema and safely adds columns introduced after the initial Slice 1.1 database, so repeated local runs are allowed.
