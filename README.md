# Virtual OCPP

Virtual OCPP is a self-hosted OCPP service for connecting a Smart EVSE charger to a local primary CSMS, recording charging activity, and eventually proxying selected OCPP traffic to external backends.

This repository currently includes the project foundation, the first OCPP 1.6j local-primary server slice, global tag management with explicit per-charger access, charger-scoped proxy target management, per-proxy tag mapping, persistent outbound OCPP mirroring, charger connectivity warnings, live charging state that stays in `Charging` while waiting for the first `MeterValues`, SmartEVSE offline replay recovery for `StopTransaction` `transactionId = -1`, the OCPP charger simulator, protected global and charger-scoped dashboards, protected operator visibility pages with stale-session audit checks, runtime proxy health, a redacted communication journal for protocol troubleshooting, and a production Docker image.

## Stack

- Backend: Node.js, TypeScript, Fastify
- Frontend: React, TypeScript, Vite, shadcn/ui-ready structure
- Database: SQLite with Drizzle migrations
- Tests: Vitest

## Requirements

- Node.js 22 or newer
- npm 11 or newer

## Setup

```sh
npm install
cp .env.example .env
npm run db:migrate
```

Set secure values in `.env` before running outside local development.

The server automatically loads `.env` from the current working directory or nearby parent directories, so both `npm run dev:server` from the repo root and direct commands from `apps/server` can use the root `.env` file. Shell-provided environment variables still take precedence over `.env` values.

## Environment Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | No | `development` | Runtime mode. The Docker image sets this to `production`. |
| `PORT` | No | `8797` | Backend HTTP port. |
| `HOST` | No | `0.0.0.0` | Backend bind host. |
| `SQLITE_PATH` | No | `./data/virtual-ocpp.sqlite` | SQLite database file path. |
| `DB_PATH` | No | None | Alias for `SQLITE_PATH`; takes precedence when set. |
| `WEB_DIST_PATH` | No | Auto-detected | Built frontend directory. The Docker image sets this internally. |
| `SESSION_SECRET` | Yes | None | At least 32 characters; signs admin session cookies. |
| `ADMIN_USERNAME` | No | `admin` | Local admin username. |
| `ADMIN_PASSWORD` | Yes | None | Local admin password; must not be empty. |
| `OCPP_BASIC_AUTH_PASSWORD` | No | None | Optional charger Basic Auth password. When set, the charger Basic Auth username must match the charger id. |
| `OCPP_PUBLIC_URL` | No | `ws://localhost:<PORT>/ocpp/:chargerId` | Optional charger WebSocket URL template shown on the dashboard; set this for TLS/reverse-proxy deployments. |
| `CHARGER_SILENT_AFTER_SECONDS` | No | `300` | Number of seconds without charger traffic before the UI marks a charger as silent. |
| `METER_GAP_THRESHOLD_WH` | No | `1000` | Minimum meter delta, in Wh, before offline recovery suggestions are created. |

## Commands

```sh
npm run dev          # run server and web dev processes
npm run dev:server   # run Fastify server only
npm run dev:web      # run Vite frontend only
npm run dev:stop     # stop Virtual OCPP dev server processes
npm run simulator     # run the local OCPP charger simulator
npm run build        # build all workspaces
npm test             # run all workspace tests
npm run lint         # typecheck all workspaces
npm run db:migrate   # apply Drizzle migrations
```

The frontend dev server runs at `http://localhost:5173`. It proxies `/api` and `/health` to the backend at `http://localhost:8797`.

Protected frontend pages use client-side routes so refresh and browser back/forward keep the current page: `/`, `/charger-dashboard`, `/proxy-targets`, `/tag-access`, `/chargers`, `/tags`, `/sessions`, and `/communication`. The selected charger context is preserved in `?chargerId=...`.

## Deployment

The production Docker image serves the API, OCPP websocket endpoint, and built frontend from one Fastify process:

```sh
npm run docker:build
docker run --rm -p 8797:8797 -v virtual-ocpp-data:/data \
  -e SESSION_SECRET=replace-with-at-least-32-random-characters \
  -e ADMIN_PASSWORD=replace-me \
  wimhaanstra/virtual-ocpp:latest
```

Use `npm run docker:publish` to update the package version to a date-stamped prerelease, then push multi-platform `linux/amd64` and `linux/arm64` tags for `wimhaanstra/virtual-ocpp:latest` and the current package-version tag to Docker Hub. Set `DOCKER_IMAGE=yourname/virtual-ocpp` to publish a different image name.

For a copy-paste Docker Compose deployment, use this compose file and replace the placeholder secrets:

```yaml
services:
  virtual-ocpp:
    image: wimhaanstra/virtual-ocpp:latest
    restart: unless-stopped
    environment:
      SESSION_SECRET: replace-with-at-least-32-random-characters
      ADMIN_PASSWORD: replace-me
      # Optional admin username. Defaults to admin.
      # ADMIN_USERNAME: admin
      # Optional charger-facing websocket URL shown in the UI. Set this to your host, IP, or reverse-proxy URL.
      # OCPP_PUBLIC_URL: ws://YOUR_HOST_OR_IP:8797/ocpp/:chargerId
      # Optional charger Basic Auth password. When set, chargers must use their charger id as username.
      # OCPP_BASIC_AUTH_PASSWORD: charger-password
      # Optional number of seconds before a charger is considered silent.
      # CHARGER_SILENT_AFTER_SECONDS: "300"
      # Optional minimum meter gap in Wh before offline recovery suggestions are created.
      # METER_GAP_THRESHOLD_WH: "1000"
    ports:
      - "8797:8797"
    volumes:
      - virtual-ocpp-data:/data

volumes:
  virtual-ocpp-data:
```

Communication journal retention defaults to 24 hours and can be changed from Settings after login. The setting is stored in the SQLite database.

See `docs/deployment.md` for Traefik/reverse proxy, TLS, storage override, and smoke-test notes.

## Current Endpoints

- `GET /health` returns service health.
- `POST /api/auth/login` accepts `{ "username": "...", "password": "..." }` and sets an HTTP-only session cookie.
- `POST /api/auth/logout` clears the session cookie.
- `GET /api/auth/me` returns the current admin user when authenticated.
- `GET /api/auth/session` returns the current admin session for the frontend shell.
- `GET /api/tags` lists global tags and their charger access rows. Requires admin session.
- `POST /api/tags` creates a tag: `{ "uuid": "...", "label": "...", "enabled": true }`. Requires admin session.
- `PATCH /api/tags/:id` updates `uuid`, `label`, or `enabled`. Requires admin session.
- `DELETE /api/tags/:id` deletes a tag. Requires admin session.
- `PUT /api/tags/:id/chargers/:chargerId` grants or updates access for a tag on one registered charger. Requires admin session.
- `DELETE /api/tags/:id/chargers/:chargerId` revokes access for a tag on one charger. Requires admin session.
- `GET /api/proxy-targets?chargerId=...` lists configured external OCPP proxy targets for a charger. Requires admin session.
- `POST /api/proxy-targets` creates a proxy target for `chargerId` with URL, optional username, optional password, optional station id, mode, outage policy, and optional `tagMappings`. Requires admin session.
- `PATCH /api/proxy-targets/:id` updates target name, URL, username, station id, enabled state, mode, outage policy, stored Basic Auth password, or per-proxy tag mappings. Requires admin session.
- `DELETE /api/proxy-targets/:id` deletes a proxy target. Requires admin session.
- `GET /api/proxy-health?chargerId=...` returns runtime upstream proxy socket health for a charger. Requires admin session.
- `GET /api/dashboard-config` returns secret-free charger connection config for the dashboard. Requires admin session.
- `GET /api/settings/communication` returns communication journal retention settings plus row-count and oldest/newest-row storage summary. Requires admin session.
- `PATCH /api/settings/communication` updates communication journal retention. Requires admin session.
- `GET /api/communication-journal` lists redacted charger/server/proxy OCPP communication rows with source/target filters. Requires admin session.
- `GET /api/communication-journal/export` downloads the current redacted journal scope as CSV. Requires admin session.
- `POST /api/communication-journal/purge` deletes expired communication journal rows, or rows matching an explicit filter scope when confirmed with `PURGE`. Requires admin session.
- `GET /api/chargers` lists recent charger connections. Requires admin session.
- `GET /api/charger-connections` is an alias for charger connection history. Requires admin session.
- `GET /api/sessions` lists recent charging sessions. Requires admin session.
- `GET /api/active-session-audit?chargerId=...` lists active sessions that may have missed `StopTransaction`, with latest meter/status context and active proxy mappings. Requires admin session.
- `POST /api/sessions/:id/remote-stop` sends OCPP `RemoteStopTransaction` to the connected charger for an active session. Requires admin session.
- `POST /api/sessions/:id/proxy-stop-recovery-suggestion` predicts the next upstream transaction id for one proxy target from the latest stored proxy mapping. Requires admin session.
- `POST /api/sessions/:id/proxy-stop-recovery-preview` previews a manual `StopTransaction` for one proxy target using an operator-supplied upstream transaction id. Requires admin session.
- `POST /api/sessions/:id/proxy-stop-recovery` sends that manual proxy `StopTransaction` for an already-stopped local session and records the recovered upstream mapping. Requires admin session.
- `POST /api/sessions/:id/close` locally closes a lingering active session record without sending an OCPP command. Requires admin session.
- `GET /api/logs` lists recent log/activity entries with safe context and without raw metadata. Requires admin session.
- `ws://host:8797/ocpp/:chargerId` accepts OCPP 1.6j charger websocket connections. The dashboard shows the configured URL template from `OCPP_PUBLIC_URL`, or a local backend-port default when no override is set.

## Current OCPP Support

Virtual OCPP acts as the local primary CSMS for connected chargers.

Implemented OCPP 1.6j calls:

- `BootNotification`
- `Heartbeat`
- `Authorize`
- `StartTransaction`
- `StopTransaction`
- `StatusNotification`
- `MeterValues`

`FirmwareStatusNotification` is accepted and recorded as charger firmware status metadata for operator visibility.

Server-initiated command:

- `RemoteStopTransaction`
- `GetConfiguration` for allowlisted operational keys
- `ChangeConfiguration` for allowlisted operational keys
- `TriggerMessage` for supported OCPP 1.6 current-state messages

Authorization uses the SQLite `tags` allowlist and `tag_charger_access`. Known enabled tags are still rejected until they have explicit enabled access for the charger that is authorizing. Unknown tags, disabled tags, or tags without charger access are rejected. Operators can manage global tags and grant/revoke selected-charger access from the protected admin UI.

Proxy targets are scoped directly to one charger. A charger can have at most three enabled proxy targets; disabled targets can still be saved for later. A charger with no enabled proxy targets does not mirror traffic. `BootNotification`, `Heartbeat`, `Authorize`, `StartTransaction`, `StatusNotification`, `MeterValues`, and `StopTransaction` are forwarded to enabled proxy targets for the active charger in deterministic oldest-first order.

Virtual OCPP keeps one upstream OCPP websocket connection per charger and proxy target. The connection uses the target `stationId` as the upstream OCPP identity when configured, otherwise it uses the local charger id. When a charger connects, enabled proxy targets for that charger are warmed immediately instead of waiting for the next authorization or transaction call. If a proxy call or connection fails, the connection is closed, a short exponential reconnect backoff is recorded in memory, and the service keeps retrying while the local charger remains connected. Runtime proxy state is available through the dashboard and `GET /api/proxy-health`; proxy connect, reconnect, close, and outage events are also written to logs without exposing passwords.

Enabled deny-capable proxy targets are also checked during `Authorize` and `StartTransaction`. If any deny-capable target returns a non-`Accepted` tag status, Virtual OCPP rejects the local authorization. If a deny-capable target is unavailable, its outage policy controls the local decision:

- `fail-open`: continue allowing locally accepted tags.
- `fail-closed`: reject locally accepted tags while the target is unavailable.

Monitor-only targets receive mirrored calls but never affect the local charger decision.

Proxy targets can define tag mappings for outbound `Authorize` and `StartTransaction` calls. Local authorization still uses the charger-supplied tag and local sessions keep that original tag, but the selected proxy receives the configured outbound tag. Different proxy targets can map the same local tag to different outbound tags.

When an upstream target returns its own transaction id from `StartTransaction`, Virtual OCPP stores a per-target transaction mapping. Later `MeterValues` and `StopTransaction` calls are forwarded with that upstream transaction id while the charger continues using the local transaction id.

SmartEVSE offline replay `StopTransaction` messages with `transactionId = -1` are recovered when they match exactly one active session. The server rewrites the call to the recovered local transaction, closes that session, and forwards the recovered transaction id to any active proxy mappings. Ambiguous or timestamp-less replays are logged for review and left unmatched.

Charging sessions, meter samples, charger connection events, authorization decisions, status notifications, and firmware status notifications are persisted to SQLite. Raw OCPP meter sample values are retained, and supported numeric samples are also normalized for dashboard use:

- `Energy.Active.Import.Register` is normalized to Wh, including kWh samples.
- `Power.Active.Import` is normalized to W, including kW samples.
- Aggregate/no-phase `Current.Import` and `Voltage` are exposed as amps and volts when supplied by the charger.
- `Temperature` is normalized to Celsius when supplied by the charger.

The dashboard can show live energy used, charging speed, current, temperature, and phase current details when the charger emits periodic `MeterValues`. OCPP 1.6 allows `MeterValues.transactionId` to be omitted, so Virtual OCPP can safely match transactionless samples to the active session by charger, connector, and sample time when the match is unambiguous. While a session is waiting for its first meter sample, the UI keeps the card in `Charging` instead of reverting to an idle state. Chargers that only send `StartTransaction.meterStart` and `StopTransaction.meterStop` still produce session totals once stopped, but live power/current/voltage/temperature remain unavailable.

## OCPP Charger Simulator

The simulator connects as a fake OCPP 1.6j charger and runs a full demo flow: `BootNotification`, `StatusNotification`, `Heartbeat`, `Authorize`, `StartTransaction`, `MeterValues`, `StopTransaction`, and final `StatusNotification`.

Run it against a local server:

```sh
npm run simulator -- --charger-id SIM-001 --tag-id SIM-TAG-001 --ensure-tag
```

`--ensure-tag` logs into the admin API using `ADMIN_USERNAME` and `ADMIN_PASSWORD`, creates/enables the tag if needed, and grants it access to the simulator charger. Without `--ensure-tag`, unknown tags are expected to be rejected by local authorization.

Useful options:

- `--url ws://localhost:8797/ocpp`: OCPP websocket endpoint.
- `--charger-id SIM-001`: charger identity.
- `--tag-id SIM-TAG-001`: tag id used for authorization and session start.
- `--meter-samples 3`: number of meter samples to emit.
- `--sample-interval-ms 1000`: delay between meter samples.
- `--run-time 15m`: run a timed charging session instead of a fixed sample count. Supports `ms`, `s`, `m`, and `h`.
- `--power-kw 11`: charging power used with `--run-time`; defaults to `11` kW when timed mode is enabled.
- `--basic-auth-password ...`: charger Basic Auth password when `OCPP_BASIC_AUTH_PASSWORD` is configured.
- `--keep-open`: keep the websocket connected and continue heartbeats after the demo session.

Pressing `Ctrl+C` during an accepted simulator session sends `StopTransaction` with the latest simulated meter value before disconnecting, so the session should not remain active.

Example timed session:

```sh
npm run simulator -- --charger-id SIM-001 --tag-id SIM-TAG-001 --ensure-tag --run-time=15m --power-kw=11
```

The simulator also supports `SIMULATOR_*` environment variables, for example `SIMULATOR_CHARGER_ID`, `SIMULATOR_TAG_ID`, and `SIMULATOR_ENSURE_TAG=true`.

## Admin Management

The whole frontend interface is protected by the local admin session. Unauthenticated users only see the sign-in screen.

The current frontend includes global tag management, selected-charger tag access, and charger-scoped proxy target operations:

- Sign in using `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
- Select a charger context from auto-registered chargers.
- Add a tag UUID with an optional label.
- Choose whether the tag is enabled for charging.
- Edit, toggle, or delete tags.
- Grant or revoke a global tag's access to the selected charger.
- Add proxy targets per charger with name, URL, optional credentials, station id, mode, outage policy, and enabled state. Up to three targets can be enabled for one charger at the same time.
- Enter the proxy target URL as the upstream base websocket URL. Virtual OCPP appends the configured station id, or the local charger id when station id is blank, as the OCPP websocket identity path. For example, URL `ws://10.210.1.1:8887` plus station id `8889` connects upstream as `ws://10.210.1.1:8887/8889`.
- Edit, toggle, or delete proxy targets.
- Edit proxy credentials through masked inputs; unchanged masks preserve stored values, cleared inputs remove stored values.
- Add per-proxy tag mappings so an upstream receives a different idTag than the charger sends locally.
- Open the protected default global dashboard for a clean fleet overview of connected chargers, active sessions, live charge details when available, and sessions needing attention.
- Use the charger-scoped dashboard for a compact charger summary with session totals, stored energy, last-session energy, active-session state, local OCPP connection info, runtime proxy target state, live charging energy/power/current/voltage when available, diagnostics/configuration commands, and missing-stop audit warnings.
- Choose 12-hour or 24-hour timestamp display from Settings. The preference is stored in the browser.
- View recent charging sessions.
- Review missing-stop audit warnings for active sessions where the charger appears available/disconnected or an accepted remote stop has not produced `StopTransaction`.
- Request a real OCPP remote stop for active sessions when the charger is connected.
- Query allowlisted charger configuration keys, change allowlisted operational keys, and trigger supported current-state OCPP messages from the charger dashboard. The command payloads and responses are recorded in the communication journal.
- Close lingering active session records from the Sessions page. This is a local cleanup action for stale records and proxy mappings, not a remote stop-charging command.
- Recover an orphaned upstream proxy session by previewing and sending a manual proxy `StopTransaction` for an already-stopped local session. The recovery modal shows a predicted upstream transaction id when it can infer one from the latest stored mapping for that proxy target.
- View full redacted OCPP communication on the Communication page, filter by source/target/method/message type, expand payloads, export filtered CSV, and manually purge expired or explicitly filtered rows.

Tag access and proxy target changes affect OCPP behavior immediately because the server reads current SQLite state during authorization and proxied calls. Proxy target edits and deletes are rejected while that charger/target has an active mirrored transaction mapping, so in-flight upstream sessions are not silently orphaned.

When a charger starts a new accepted transaction on a connector, Virtual OCPP automatically closes any older active local session on that same charger connector with reason `ReplacedByNewTransaction`. Other connectors on the same charger are left untouched.

Remote stop requests send `RemoteStopTransaction` to the connected charger with the local transaction id. The local session remains active until the charger confirms the stop by sending `StopTransaction`; use the local close action only for stale records that the charger will no longer close itself.

## Planned V1 Features

- Single Docker image with persistent SQLite volume.

## Security Notes

- Do not expose the service publicly without TLS and admin authentication.
- Do not commit `.env`, SQLite data, logs, or credentials.
- Proxy credentials and OCPP auth material must be masked in logs, UI, tests, and documentation.

## AI-Assisted Development

This project has been built with AI-assisted development workflows. Human maintainers remain responsible for reviewing code, validating behavior, running tests, and deciding what is released.
