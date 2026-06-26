# External API

Virtual OCPP exposes a cookie-authenticated admin API, scoped bearer tokens for external clients, a charger websocket endpoint, and an MCP bridge.

## Auth And Tokens

- `POST /api/auth/login` accepts `{ "username": "...", "password": "..." }`.
- `POST /api/auth/register` accepts `{ "username": "...", "password": "..." }` and creates a new tenant account with a generated account name. The first user is added as `owner`.
- `POST /api/auth/invites` creates a one-time invite code for an existing tenant. It requires an authenticated owner session and accepts `{ "role": "owner" | "admin" | "viewer" }`.
- `GET /api/auth/invites/:code` previews a valid unredeemed invite and returns the target account name and role.
- `POST /api/auth/invites/accept` accepts `{ "code": "...", "username": "...", "password": "..." }`. If the username exists, the password must match and the existing user joins the invited tenant; otherwise a new user is created.
- `POST /api/auth/invites/redeem` accepts `{ "code": "..." }` for an already authenticated user and joins the invited tenant.
- `POST /api/auth/accounts/select` accepts `{ "tenantId": "..." }` and switches the current session to another account the user belongs to.
- `PATCH /api/auth/accounts/:tenantId` accepts `{ "name": "..." }` and renames an account. The caller must be an owner of the active account or the configured super admin.
- On success the server sets a signed, HTTP-only session cookie named `virtual_ocpp_session`.
- The cookie lives for 12 hours.
- The cookie is marked `Secure` when the request is served over HTTPS or behind `X-Forwarded-Proto: https`.
- `GET /api/auth/session` and `GET /api/auth/me` return the current user, tenant, role, and account memberships when the cookie is valid.
- The configured env admin is marked `isSuperAdmin` after a successful configured-password login and receives all tenant accounts in the membership list for account switching.
- `POST /api/auth/logout` revokes the current session and clears the cookie.
- `GET /api/access-tokens` lists API tokens. This route requires the admin cookie; bearer tokens cannot manage tokens.
- `POST /api/access-tokens` creates a token with `{ "name": "...", "scope": "read_only" | "read_write", "expiresAt": null | "..." }`. The plaintext token is returned once.
- `POST /api/access-tokens/:id/revoke` or `DELETE /api/access-tokens/:id` revokes a token.
- `POST /api/access-tokens/:id/rotate` replaces a token secret and returns the new plaintext token once.

Bearer tokens are sent as:

```http
Authorization: Bearer <32-character-token>
```

Only a SHA-256 hash of the token is stored. Tokens are scoped to the issuing tenant. `read_only` tokens can call read routes and preview routes. `read_write` tokens can also call mutation routes and charger command routes. Legacy `v1.<token-id>.<secret>` tokens are still accepted.

The charger onboarding wizard creates tenant-specific pairing URLs through `POST /api/charger-pairings`. The response includes a short-lived URL like `/ocpp/t/:tenantPublicId/:pairingCode/:chargerId`, and can optionally include display-once Basic Auth credentials for that pairing session.

Chargers paired through the tenant-specific URL are stored with a tenant-scoped charger id based on the URL tenant segment and the charger-supplied identity, for example `tenant-public-id/charger-identity`. The charger-supplied identity is not trusted as a globally unique id.

Legacy `/ocpp/:chargerId` connections still work for existing/local flows. New onboarding should use the tenant-specific pairing URL shown in the wizard.

## Endpoint Groups

### Public Health

- `GET /health`
- `GET /ready`

### Session Bootstrap

- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/invites`
- `GET /api/auth/invites/:code`
- `POST /api/auth/invites/accept`
- `POST /api/auth/invites/redeem`
- `POST /api/auth/accounts/select`
- `PATCH /api/auth/accounts/:tenantId`
- `GET /api/auth/session`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/access-tokens`
- `POST /api/access-tokens`
- `POST /api/access-tokens/:id/revoke`
- `POST /api/access-tokens/:id/rotate`
- `DELETE /api/access-tokens/:id`
- `GET /api/dashboard-config`
- `POST /api/charger-pairings`

`/api/dashboard-config` returns the legacy charger websocket URL template, OCPP protocol version, and app version. `POST /api/charger-pairings` returns the tenant-specific onboarding URL and optional Basic Auth credentials for the current pairing session.

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
