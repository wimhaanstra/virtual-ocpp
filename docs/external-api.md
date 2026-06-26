# External API

Virtual OCPP exposes a cookie-authenticated admin API, scoped bearer tokens for external clients, a charger websocket endpoint, and an MCP bridge.

## Auth And Tokens

- `POST /api/auth/login` accepts `{ "username": "...", "password": "..." }`.
- On success the server sets a signed, HTTP-only session cookie named `virtual_ocpp_session`.
- The cookie lives for 12 hours.
- The cookie is marked `Secure` when the request is served over HTTPS or behind `X-Forwarded-Proto: https`.
- `GET /api/auth/session` and `GET /api/auth/me` return the current admin session when the cookie is valid.
- `POST /api/auth/logout` revokes the current session and clears the cookie.
- `GET /api/access-tokens` lists API tokens. This route requires the admin cookie; bearer tokens cannot manage tokens.
- `POST /api/access-tokens` creates a token with `{ "name": "...", "scope": "read_only" | "read_write", "expiresAt": null | "..." }`. The plaintext token is returned once.
- `POST /api/access-tokens/:id/revoke` or `DELETE /api/access-tokens/:id` revokes a token.
- `POST /api/access-tokens/:id/rotate` replaces a token secret and returns the new plaintext token once.

Bearer tokens are sent as:

```http
Authorization: Bearer <32-character-token>
```

Only a SHA-256 hash of the token is stored. `read_only` tokens can call read routes and preview routes. `read_write` tokens can also call mutation routes and charger command routes. Legacy `v1.<token-id>.<secret>` tokens are still accepted.

The charger websocket can also use Basic Auth when `OCPP_BASIC_AUTH_PASSWORD` is set.

- Username must match the charger id.
- Password must match `OCPP_BASIC_AUTH_PASSWORD`.

## Endpoint Groups

### Public Health

- `GET /health`
- `GET /ready`

### Session Bootstrap

- `POST /api/auth/login`
- `GET /api/auth/session`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/access-tokens`
- `POST /api/access-tokens`
- `POST /api/access-tokens/:id/revoke`
- `POST /api/access-tokens/:id/rotate`
- `DELETE /api/access-tokens/:id`
- `GET /api/dashboard-config`

`/api/dashboard-config` returns the charger websocket URL template, OCPP protocol version, whether charger Basic Auth is required, and the app version.

### Inventory And Configuration

- `GET /api/chargers`
- `PATCH /api/chargers/:id`
- `POST /api/chargers/:id/meter-gaps/scan`
- `DELETE /api/chargers/:id`
- `GET /api/tags`
- `POST /api/tags`
- `PATCH /api/tags/:id`
- `DELETE /api/tags/:id`
- `PUT /api/tags/:id/chargers/:chargerId`
- `DELETE /api/tags/:id/chargers/:chargerId`
- `GET /api/charger-proxy-assignments`
- `POST /api/charger-proxy-assignments`
- `PATCH /api/charger-proxy-assignments/:id`
- `DELETE /api/charger-proxy-assignments/:id`
- `GET /api/proxy-targets`
- `POST /api/proxy-targets`
- `PATCH /api/proxy-targets/:id`
- `DELETE /api/proxy-targets/:id`
- `GET /api/proxy-health`

### Runtime Visibility

- `GET /api/charger-connections`
- `GET /api/sessions`
- `GET /api/sessions/search`
- `GET /api/session-summary`
- `GET /api/active-session-audit`
- `GET /api/proxy-stop-recovery-queue`
- `GET /api/meter-gap-events`
- `POST /api/meter-gap-events/:id/dismiss`
- `GET /api/meter-gap-events/:id/recovery-preview`
- `POST /api/meter-gap-events/:id/submit`
- `GET /api/logs`
- `GET /api/communication-journal`
- `GET /api/communication-journal/export`
- `POST /api/communication-journal/purge`
- `GET /api/live-updates`
- `GET /api/settings/onboarding`
- `PATCH /api/settings/onboarding`
- `GET /api/settings/communication`
- `PATCH /api/settings/communication`
- `GET /api/diagnostics/smartevse/:chargerId`

### Charger Command Surface

- `POST /api/chargers/:id/commands/get-configuration`
- `POST /api/chargers/:id/commands/change-configuration`
- `POST /api/chargers/:id/commands/trigger-message`
- `POST /api/sessions/:id/remote-stop`
- `GET /api/sessions/:id/force-close-preview`
- `POST /api/sessions/:id/force-close`
- `POST /api/sessions/:id/proxy-stop-recovery-suggestion`
- `POST /api/sessions/:id/proxy-stop-recovery-preview`
- `POST /api/sessions/:id/proxy-stop-recovery`
- `POST /api/proxy-stop-recovery-queue/:mappingId/retry`
- `POST /api/sessions/:id/close`

## Permissions

- All `/api/*` routes above require an admin session or bearer token, except the auth routes themselves.
- Access-token management routes require the admin session cookie.
- Read-only bearer tokens can call read routes plus preview/suggestion routes.
- Read-write bearer tokens are required for writes, purges, charger commands, remote stop, force close, and recovery submissions.
- The charger websocket at `/ocpp/:chargerId` is not admin-authenticated.
- `POST /api/chargers/:id/commands/*` and the session recovery routes require a connected charger or a configured proxy service, depending on the operation.
- `GET /api/proxy-health` and the proxy-target routes are charger-scoped. They still require the admin session, but the `chargerId` query parameter or route context must match an existing charger.
- `DELETE /api/chargers/:id` additionally requires the admin password in the request body plus exact charger id confirmation.

## Examples

### Login And Reuse The Cookie

```sh
curl -c cookie.txt \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"correct-password"}' \
  http://localhost:8797/api/auth/login

curl -b cookie.txt http://localhost:8797/api/chargers
```

### Request Charger Diagnostics

```sh
curl -b cookie.txt \
  -H 'content-type: application/json' \
  -d '{"key":["HeartbeatInterval","MeterValueSampleInterval"]}' \
  http://localhost:8797/api/chargers/SMART-EVSE-1/commands/get-configuration
```

### Create And Use A Bearer Token

```sh
curl -b cookie.txt \
  -H 'content-type: application/json' \
  -d '{"name":"SmartEVSE diagnostics","scope":"read_only","expiresAt":null}' \
  http://localhost:8797/api/access-tokens

curl -H "authorization: Bearer $VIRTUAL_OCPP_API_TOKEN" \
  http://localhost:8797/api/diagnostics/smartevse/SMART-EVSE-1
```

### Inspect SmartEVSE Evidence

```sh
curl -b cookie.txt \
  "http://localhost:8797/api/communication-journal?chargerId=SMART-EVSE-1&ocppMethod=FirmwareStatusNotification&messageType=call"

curl -b cookie.txt \
  "http://localhost:8797/api/logs?chargerId=SMART-EVSE-1"
```

## MCP Usage

Virtual OCPP exposes the same curated MCP tool surface over HTTP and stdio. There is no raw HTTP passthrough; every tool maps to a known API route.

### HTTP Transport

Use the backend URL, not the Vite frontend URL. In local development this is usually `http://localhost:8797/mcp`, not `http://localhost:5173/mcp`.

VS Code `mcp.json`:

```json
{
  "servers": {
    "virtual-ocpp": {
      "type": "http",
      "url": "http://localhost:8797/mcp",
      "headers": {
        "Authorization": "Bearer <32-character-token>"
      }
    }
  }
}
```

For production, replace the URL with `https://your-virtual-ocpp-host/mcp`.

### Stdio Transport

The `@virtual-ocpp/mcp` workspace can still be used as a local stdio bridge.

Set:

```sh
VIRTUAL_OCPP_API_URL=http://localhost:8797
VIRTUAL_OCPP_API_TOKEN=<32-character-token>
```

Run:

```sh
npm run start --workspace=@virtual-ocpp/mcp
```

Use a `read_only` token for diagnostics and exports. Use a `read_write` token only when the MCP client must mutate configuration or send charger commands.

Useful tools include `chargers_list`, `sessions_search`, `communication_journal_list`, `communication_journal_export`, `diagnostics_smartevse`, and the explicit charger command tools.

## SmartEVSE Diagnostics Evidence

The repository keeps diagnostics evidence in three places:

- the redacted communication journal
- the structured log feed
- the charger/session runtime tables surfaced through the visibility routes

Useful evidence sources:

- `FirmwareStatusNotification` is tracked as an inbound OCPP call and appears in the communication journal.
- `TriggerMessage` accepts `DiagnosticsStatusNotification`, `FirmwareStatusNotification`, `Heartbeat`, `MeterValues`, `StatusNotification`, and `BootNotification`.
- If a charger sends an unsupported OCPP method, the server records a `NotImplemented` error in both the communication journal and logs.
- Raw malformed OCPP frames are stored as redacted `raw` journal rows and logged with a short preview.
- `GET /api/communication-journal/export` returns the same redacted evidence as CSV.
- `GET /api/logs` returns the safe log context for charger and command activity.
- `GET /api/diagnostics/smartevse/:chargerId` summarizes MeterValues cadence, active session state, recent journal methods, connection windows, proxy mappings, and an operator-oriented interpretation.

For SmartEVSE investigations, the most useful filters are:

- `chargerId=...`
- `ocppMethod=FirmwareStatusNotification`
- `ocppMethod=DiagnosticsStatusNotification`
- `messageType=call`
- `messageType=callResult`
- `messageType=callError`
- `messageType=raw`

If you need a single operator narrative, start with `GET /api/active-session-audit?chargerId=...`, then check the communication journal and logs for the matching charger id and transaction id.
