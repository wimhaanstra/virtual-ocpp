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
- Persistent outbound OCPP mirroring for supported charger calls
- Per-target external transaction id mapping for mirrored sessions
- Repo-local OCPP charger simulator for demos and smoke tests
- Protected operator visibility APIs for charger connections, sessions, and logs
- Protected global dashboard as the default admin view, showing connected chargers, active sessions, live charge details, and sessions needing attention
- Charger-scoped dashboard showing OCPP connection info, protocol/auth requirements without secrets, charger connection status, runtime proxy health, live charging state, missing-stop checks, and quick links
- Protected communication journal API/page with redacted charger/server/proxy protocol payloads, source/target filtering, and configurable automatic purge
- Protected charger registry and charger context selector
- Charger-scoped proxy targets so each local charger chooses which upstreams it mirrors to
- Global tags with explicit per-charger access controls
- Frontend global dashboard, charger dashboard, chargers, tag, tag access, proxy target, sessions, and communication pages as the active admin pages
- Frontend component split for shared types/helpers, app chrome, auth, dashboard, sessions, communication, and force-close review modal
- Charger onboarding wizard that waits for a newly registered charger and then switches the selected charger context
- Production Docker image that serves the compiled backend and frontend from one container with `/data` as the SQLite volume

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

- `/`: global dashboard
- `/charger-dashboard`: charger-scoped dashboard
- `/proxy-targets`: charger-scoped proxy targets
- `/tag-access`: charger-scoped tag grants for the selected charger
- `/chargers`: global charger registry with rename and destructive delete flow
- `/tags`: global tag identity management
- `/sessions`: charging sessions
- `/communication`: redacted OCPP communication journal

The selected charger context is stored in `?chargerId=...`, so refresh and browser back/forward preserve the active page and charger. Vite handles local development fallback for these routes, and the production Fastify server provides the same single-page app fallback for deep links.

The production Fastify server serves the compiled Vite app from `apps/web/dist` when `NODE_ENV=production`. Unknown frontend routes fall back to `index.html`; reserved backend paths such as `/api/*`, `/health`, and `/ocpp/:chargerId` do not fall back to the SPA.

Frontend shared data contracts live in `apps/web/src/types.ts`. Formatting, routing, charger context, filter, and form defaults live in `apps/web/src/app-helpers.ts`. Page-level rendering that has already been split out lives under `apps/web/src/components/`; `App.tsx` remains the controller for authenticated state, API loading, and mutations.

The protected frontend opens `GET /api/live-updates` with `EventSource` after admin login. The endpoint uses the signed admin session cookie, sends `live-update` SSE events, and replays recent events when the browser reconnects with `Last-Event-ID`. Events are typed by backend change source, but the frontend treats them as invalidation hints and refetches the affected REST slices. Manual refresh buttons remain as fallback controls, and the topbar shows `Live`, `Connecting`, or `Stale`.

## Testing

```sh
npm test
npm run build
```

Tests should stay focused on the changed behavior for each slice. Future OCPP tests should use fake OCPP clients and external backend stubs rather than live charger hardware.

The OCPP integration tests bind a local ephemeral port. In sandboxed environments they may need approval to run with normal localhost networking permissions.

## Simulator Workflow

Run the repo-local OCPP charger simulator from the root:

```sh
npm run simulator -- --charger-id SIM-001 --tag-id SIM-TAG-001 --ensure-tag
```

The simulator uses `ocpp-rpc` as a charger client and sends a full session flow through the real websocket endpoint. `--ensure-tag` uses the protected admin API to create or enable the configured tag and grant access to the simulator charger after the charger has connected. This keeps simulator setup aligned with the same tag access rules used by Smart EVSE traffic.

Use `--run-time=15m --power-kw=11` to simulate a timed charging session at 11 kW. `--run-time` accepts `ms`, `s`, `m`, and `h` units, including combined values such as `1h30m`. In timed mode the simulator calculates energy from elapsed time and power, then emits periodic meter values.

Pressing `Ctrl+C` during an accepted simulator transaction sends a final `StopTransaction` with the latest simulated meter value, then disconnects the charger websocket.

Use `--keep-open` when you want the dashboard to continue showing the simulator as connected after the demo session. Use `npm run simulator -- --help` to see all CLI options.

## Tag Workflow

Tags are stored globally in SQLite, but each charger must be granted explicit access to a tag before that tag can authorize charging during `Authorize` or `StartTransaction`:

- enabled tag with enabled access for the charger: accepted
- disabled tag: rejected
- unknown tag: rejected
- enabled tag without charger access: rejected

The tag API, global Tags page, and charger-scoped Tag access page are protected by the local admin session cookie. Frontend requests use same-origin `/api/*` paths; Vite proxies those to the backend during local development.

Newly created tags grant access to no chargers by default. Use the Tag access page with a selected charger context, or `PUT /api/tags/:id/chargers/:chargerId`, to grant access.

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
- `tagMappings`: optional local-to-outbound idTag mappings for this proxy target.

During `Authorize` and `StartTransaction`, Virtual OCPP first checks the global tag and charger-specific access. If the tag is locally rejected, proxy targets are not consulted. If the tag is locally accepted, enabled `deny-capable` targets for that charger are called in order. Any non-`Accepted` proxy response rejects the local operation.

Per-proxy tag mappings are applied only to outbound `Authorize` and `StartTransaction` calls. Local allowlist checks, local session records, and charger responses keep the original charger-supplied idTag. The communication journal records the actual outbound proxy payload, so a mapped proxy call shows the outbound idTag.

Unavailable deny-capable targets follow their configured outage policy. `fail-open` keeps the local allow decision; `fail-closed` rejects the operation until the target is reachable again. `monitor-only` targets receive mirrored calls but do not affect local charger decisions.

Mirrored calls are sent to each enabled proxy target for the active charger:

- `BootNotification`
- `Heartbeat`
- `Authorize`
- `StartTransaction`
- `StatusNotification`
- `MeterValues`
- `StopTransaction`

Virtual OCPP keeps one outbound OCPP client connection per local charger and proxy target. If target `stationId` is configured, it is used as the upstream OCPP identity; otherwise the local charger id is used. On startup, any charger connection rows left open by a previous process are marked disconnected; upstream proxy targets are not warmed until the real charger reconnects. When a charger connects, enabled proxy targets for that charger are warmed immediately with `BootNotification`, `StatusNotification`, and `Heartbeat` so upstream platforms can mark the charger online without waiting for the next mirrored charger call. Connections are reused across mirrored calls, closed when target configuration changes or the target is no longer enabled, and closed on server shutdown. If a connection or call fails, the connection is evicted and an in-memory exponential reconnect backoff is scheduled; while the charger remains connected, Virtual OCPP retries the upstream warm-up in the background after the backoff window. Connect, reconnect, close, and outage decisions are logged without exposing credentials.

When a proxy target returns a transaction id from `StartTransaction`, the server stores it in `proxy_session_mappings`. Later `MeterValues` and `StopTransaction` calls for the local transaction are sent to that target with the mapped external transaction id.

## Dashboard Workflow

The protected default admin view is the global dashboard. It is read-only and gives operators a clean first-screen fleet overview:

- connected versus registered chargers
- active sessions
- chargers with live charge details when `MeterValues` are available
- session audit warnings that need operator attention

The charger-scoped dashboard is available at `/charger-dashboard` and gives operators selected-charger setup and runtime details:

- local OCPP connection URL
- expected websocket protocol
- optional Basic Auth requirement without exposing secrets
- charger connection status and recent activity summary
- active charging energy, power, current, and voltage from normalized `MeterValues` when the charger supplies them
- quick links to sessions, communication, tags, and proxy targets

The sidebar keeps charger-scoped pages near the charger context selector. Global pages live at the bottom above the theme and sign-out controls, separated from charger-scoped pages without extra section labels. The sidebar can collapse to icon-only navigation; the active page keeps `aria-current="page"` for accessibility.

The dashboard reads this setup information from `GET /api/dashboard-config`. That protected endpoint returns the charger URL template, the OCPP websocket subprotocol, and whether charger Basic Auth is required. It never returns the Basic Auth password. By default the displayed URL uses the backend `PORT`; set `OCPP_PUBLIC_URL` when the charger should connect through a reverse proxy or TLS hostname.

Operators can start the charger wizard from the topbar charger controls or the dashboard. The wizard snapshots the currently known charger ids, shows the same OCPP URL template/protocol/auth guidance, then waits for the next charger that appears in `GET /api/chargers`. Live updates usually refresh the registry automatically; the wizard also has a manual refresh fallback. Finishing the wizard optionally saves a charger label with `PATCH /api/chargers/:id` and switches the UI context to the detected charger.

Live charging stats are read from `GET /api/charging-stats`, scoped with the same optional `chargerId` query parameter as the other visibility endpoints. The endpoint derives active-session values from `charging_sessions` and `meter_samples`: energy import register samples are normalized to Wh, power import samples to W, and aggregate/no-phase current/voltage are returned when present. Phase-scoped current/voltage samples are stored for later detail views but are not displayed as total charger current or voltage. If a charger does not send periodic `MeterValues`, the dashboard still shows the active transaction but leaves live meter fields blank until data arrives.

The dashboard also shows selected-charger proxy target health from `GET /api/proxy-health`, which reports the in-memory runtime state of persistent upstream sockets. The response includes a summary plus one row per charger-scoped proxy target with state, detail, last success/failure timestamps, and the next reconnect time when backoff is active. This is advisory operational state; it is not inferred from logs and it resets when the server process restarts.

The dashboard and sessions page also read `GET /api/active-session-audit`, scoped by optional `chargerId`. The audit lists active sessions with latest meter sample context, latest connector status, active proxy transaction mappings, and warnings for cases that may indicate a missing `StopTransaction`: connector `Available`/`Finishing`, charger disconnected while the session is active, or an accepted remote stop that has not produced a later stop after a short grace window. The endpoint does not close sessions by itself; it gives operators the context needed to request remote stop or open the force-close preview.

Proxy target forms treat `url` as the upstream base websocket URL and append `stationId`, or the local charger id when `stationId` is blank, as the upstream OCPP identity path. For example, URL `ws://10.210.1.1:8887` plus station id `8889` connects upstream as `ws://10.210.1.1:8887/8889`.

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

The authenticated frontend exposes read-only operational views for sessions and communication:

- `GET /api/sessions` returns recent charging sessions.
- `GET /api/active-session-audit` returns active-session warnings and stale-session context for operator review.
- `POST /api/sessions/:id/remote-stop` sends OCPP `RemoteStopTransaction` for an active session through the connected charger websocket.
- `POST /api/sessions/:id/close` marks an active session as locally closed with reason `OperatorClosed` and closes matching proxy-session mappings. It does not send a remote stop command to the charger.
- `GET /api/charging-stats` returns active session meter summaries with normalized energy and power values.
- `GET /api/proxy-health` returns runtime upstream proxy health for the selected charger.
- `GET /api/chargers` and `GET /api/charger-connections` return recent charger connection records.
- `PATCH /api/chargers/:id` renames or disables a registered charger. The frontend delete flow is wired for `DELETE /api/chargers/:id` with current admin password and exact charger id confirmation; the backend should implement the charger-owned cascade delete when that route lands. Global tags remain intact.
- `GET /api/logs` returns recent logs with `hasMetadata` and a whitelisted context subset, but never raw metadata.
- `GET /api/live-updates` streams authenticated Server-Sent Events for operator UI invalidation. It does not expose secrets or replace the REST APIs; it only tells the UI which data slices should be refreshed.

The sessions page shows charger id, connector, transaction id, tag id, status, timestamps, meter readings, stop reason, a remote stop action for active connected charger sessions, and a force-close action for lingering active session records. Active-session audit warnings are shown inline so operators can see why a session needs review before acting. Remote stop is a charger command: it records the request/result in the communication journal and activity logs, but the local session remains active until the charger sends `StopTransaction`. Force close first shows a preview of the synthesized `StopTransaction` payload that will be sent to each active proxy mapping, using the latest stored energy meter sample for that charger/connector after the session started when the charger did not provide a final stop. After operator confirmation, Virtual OCPP attempts proxy `StopTransaction` calls before marking the local session stopped with reason `OperatorForceClosed`. The legacy local close endpoint is only for stale record cleanup. For logs, only safe context fields such as `proxyTargetId`, `method`, and `status` are exposed.

Accepted `StartTransaction` calls automatically close older active local sessions for the same `chargerId` and `connectorId` with reason `ReplacedByNewTransaction`. Before closing the replaced local session, Virtual OCPP sends `StopTransaction` to active proxy mappings using the latest stored energy meter sample for that session when available. This avoids stale sessions for single-connector chargers without incorrectly closing legitimate sessions on other connectors.

## Database

The app uses SQLite through Drizzle. By default the database lives at:

```text
./data/virtual-ocpp.sqlite
```

The `data` directory is ignored by git and should become the Docker volume mount point in the deployment milestone.

The current migration script creates the baseline schema and safely adds columns introduced after the initial Slice 1.1 database, so repeated local runs are allowed.
