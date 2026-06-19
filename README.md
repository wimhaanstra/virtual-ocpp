# Virtual OCPP

Virtual OCPP is a self-hosted OCPP service for connecting a Smart EVSE charger to a local primary CSMS, recording charging activity, and eventually proxying selected OCPP traffic to external backends.

This repository currently includes the project foundation, the first OCPP 1.6j local-primary server slice, global tag management with explicit per-charger access, charger-scoped proxy target management, basic outbound OCPP mirroring, the protected home dashboard, protected operator visibility pages, and a redacted communication journal for protocol troubleshooting. Per-proxy tag mapping, persistent upstream connection management, the OCPP charger simulator, and the production Docker image are planned but not implemented yet.

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
| `PORT` | No | `3000` | Backend HTTP port. |
| `HOST` | No | `0.0.0.0` | Backend bind host. |
| `SQLITE_PATH` | No | `./data/virtual-ocpp.sqlite` | SQLite database file path. |
| `SESSION_SECRET` | Yes | None | At least 32 characters; signs admin session cookies. |
| `ADMIN_USERNAME` | No | `admin` | Local admin username. |
| `ADMIN_PASSWORD` | Yes | None | Local admin password; at least 8 characters. |
| `OCPP_BASIC_AUTH_PASSWORD` | No | None | Optional charger Basic Auth password. When set, the charger Basic Auth username must match the charger id. |
| `OCPP_PUBLIC_URL` | No | `ws://localhost:<PORT>/ocpp/:chargerId` | Optional charger WebSocket URL template shown on the dashboard; set this for TLS/reverse-proxy deployments. |
| `COMMUNICATION_LOG_RETENTION_HOURS` | No | `24` | Number of hours to keep full redacted communication journal rows before automatic purge. |
## Commands

```sh
npm run dev          # run server and web dev processes
npm run dev:server   # run Fastify server only
npm run dev:web      # run Vite frontend only
npm run dev:stop     # stop Virtual OCPP dev server processes
npm run build        # build all workspaces
npm test             # run all workspace tests
npm run lint         # typecheck all workspaces
npm run db:migrate   # apply Drizzle migrations
```

The frontend dev server runs at `http://localhost:5173`. It proxies `/api` and `/health` to the backend at `http://localhost:3000`.

Protected frontend pages use client-side routes so refresh and browser back/forward keep the current page: `/`, `/proxy-targets`, `/tags`, `/sessions`, `/activity`, and `/communication`. The selected charger context is preserved in `?chargerId=...`.

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
- `POST /api/proxy-targets` creates a proxy target for `chargerId` with URL, optional username, optional password, optional station id, mode, and outage policy. Requires admin session.
- `PATCH /api/proxy-targets/:id` updates target name, URL, username, station id, enabled state, mode, outage policy, or stored Basic Auth password. Requires admin session.
- `DELETE /api/proxy-targets/:id` deletes a proxy target. Requires admin session.
- `GET /api/dashboard-config` returns secret-free charger connection config for the dashboard. Requires admin session.
- `GET /api/communication-journal` lists redacted charger/server/proxy OCPP communication rows with source/target filters. Requires admin session.
- `POST /api/communication-journal/purge` deletes communication journal rows older than `COMMUNICATION_LOG_RETENTION_HOURS`. Requires admin session.
- `GET /api/chargers` lists recent charger connections. Requires admin session.
- `GET /api/charger-connections` is an alias for charger connection history. Requires admin session.
- `GET /api/sessions` lists recent charging sessions. Requires admin session.
- `GET /api/logs` lists recent log/activity entries with safe context and without raw metadata. Requires admin session.
- `ws://host:3000/ocpp/:chargerId` accepts OCPP 1.6j charger websocket connections. The dashboard shows the configured URL template from `OCPP_PUBLIC_URL`, or a local backend-port default when no override is set.

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

Authorization uses the SQLite `tags` allowlist and `tag_charger_access`. Known enabled tags are still rejected until they have explicit enabled access for the charger that is authorizing. Unknown tags, disabled tags, or tags without charger access are rejected. Operators can manage global tags and grant/revoke selected-charger access from the protected admin UI.

Proxy targets are scoped directly to one charger. A charger with no enabled proxy targets does not mirror traffic. `BootNotification`, `Heartbeat`, `Authorize`, `StartTransaction`, `StatusNotification`, `MeterValues`, and `StopTransaction` are forwarded to enabled proxy targets for the active charger.

Enabled deny-capable proxy targets are also checked during `Authorize` and `StartTransaction`. If any deny-capable target returns a non-`Accepted` tag status, Virtual OCPP rejects the local authorization. If a deny-capable target is unavailable, its outage policy controls the local decision:

- `fail-open`: continue allowing locally accepted tags.
- `fail-closed`: reject locally accepted tags while the target is unavailable.

Monitor-only targets receive mirrored calls but never affect the local charger decision.

When an upstream target returns its own transaction id from `StartTransaction`, Virtual OCPP stores a per-target transaction mapping. Later `MeterValues` and `StopTransaction` calls are forwarded with that upstream transaction id while the charger continues using the local transaction id.

Charging sessions, meter samples, charger connection events, authorization decisions, and status notifications are persisted to SQLite.

## Admin Management

The whole frontend interface is protected by the local admin session. Unauthenticated users only see the sign-in screen.

The current frontend includes global tag management, selected-charger tag access, and charger-scoped proxy target operations:

- Sign in using `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
- Select a charger context from auto-registered chargers.
- Add a tag UUID with an optional label.
- Choose whether the tag is enabled for charging.
- Edit, toggle, or delete tags.
- Grant or revoke a global tag's access to the selected charger.
- Add unlimited proxy targets per charger with name, URL, optional credentials, station id, mode, outage policy, and enabled state.
- Edit, toggle, or delete proxy targets.
- View whether a proxy target has stored credentials without exposing the username or password.
- Open the protected default home dashboard with local OCPP connection info, websocket protocol, optional Basic Auth requirements, charger connection status, summary metrics, and quick links to operational pages.
- View recent charging sessions.
- View charger connection activity and recent logs.
- View full redacted OCPP communication on the Communication page, filter by source/target/method/message type, expand payloads, and manually trigger retention purge.

Tag access and proxy target changes affect OCPP behavior immediately because the server reads current SQLite state during authorization and proxied calls. Proxy target edits and deletes are rejected while that charger/target has an active mirrored transaction mapping, so in-flight upstream sessions are not silently orphaned.

## Planned V1 Features

- OCPP charger simulator for local development, demos, and deployment smoke tests.
- Exact per-proxy tag ID mappings for outbound `Authorize` and `StartTransaction`.
- Persistent upstream proxy connections with reconnect/backoff state.
- Single Docker image with persistent SQLite volume.

## Security Notes

- Do not expose the service publicly without TLS and admin authentication.
- Do not commit `.env`, SQLite data, logs, or credentials.
- Proxy credentials and OCPP auth material must be masked in logs, UI, tests, and documentation.
