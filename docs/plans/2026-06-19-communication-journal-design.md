# Communication Journal Design

## Problem

Operators need a protected page that shows full OCPP communication for troubleshooting:

- charger to Virtual OCPP
- Virtual OCPP to charger
- Virtual OCPP to proxy targets
- proxy targets back to Virtual OCPP

The current `logs` table is intentionally summary-oriented and exposes only safe context. It is useful for activity feeds, but it is not suitable for full protocol tracing or retention-based purging.

## Goals

- Store full OCPP communication payloads for troubleshooting.
- Redact secrets before persistence.
- Show the communication history in a separate protected admin page.
- Allow filtering by source and target of communication.
- Keep recent history easy to inspect, especially the last 24 hours.
- Automatically purge old communication rows after a configurable retention window.
- Keep communication journal storage separate from operational logs so it can be purged independently.

## Non-Goals

- Do not replace the existing `logs` activity feed.
- Do not build live streaming updates in this slice.
- Do not build long-term analytics or reporting over journal payloads.
- Do not store unredacted credentials, authorization headers, session cookies, admin passwords, or proxy secrets.
- Do not implement persistent proxy connection tracing beyond the per-call proxy behavior that exists today.

## Current Context

- OCPP charger handling lives in `apps/server/src/ocpp/server.ts` and delegates to `OcppHandlers`.
- Charger/session/meter persistence and operational logs live in `apps/server/src/ocpp/repository.ts`.
- Proxy forwarding lives in `apps/server/src/ocpp/proxy-service.ts`.
- Existing admin visibility APIs live in `apps/server/src/visibility.ts`.
- Existing logs deliberately return safe context only, not raw metadata.
- The frontend admin shell already has protected pages and same-origin `/api/*` calls.

## Approved Approach

Create a new `communication_journal` table and a protected `Communication` admin page. This is separate from the existing `logs` table.

This keeps high-volume protocol traces independent from low-volume operational logs and makes retention/purge behavior simple and safe.

## Data Model

Add a new SQLite/Drizzle table:

```text
communication_journal
```

Columns:

- `id`: text primary key
- `created_at`: timestamp
- `direction`: `inbound` or `outbound`
- `source_type`: `charger`, `server`, or `proxy`
- `source_id`: charger id, `server`, or proxy target id/name
- `target_type`: `charger`, `server`, or `proxy`
- `target_id`: charger id, `server`, or proxy target id/name
- `charger_id`: nullable charger id
- `proxy_target_id`: nullable proxy target id
- `message_type`: `call`, `callResult`, `callError`, `connection`, or `disconnect`
- `ocpp_method`: nullable OCPP method
- `transaction_id`: nullable number
- `id_tag`: nullable text
- `payload_json`: redacted JSON text
- `error_code`: nullable text
- `error_description`: nullable text
- `correlation_id`: nullable text

Indexes should support the first UI filters:

- `created_at`
- `source_type`, `source_id`
- `target_type`, `target_id`
- `charger_id`
- `proxy_target_id`
- `ocpp_method`
- `message_type`

## Payload Policy

Store complete OCPP payloads after redaction.

Keep normal OCPP troubleshooting fields:

- `idTag`
- meter values
- station id
- connector id
- transaction id
- OCPP status values
- OCPP error codes/descriptions

Redact any field that is a secret or likely secret:

- `password`
- `secret`
- `token`
- `authorization`
- `cookie`
- `set-cookie`
- admin/session cookie material
- Basic Auth material
- proxy credentials

Redaction should recursively walk objects and arrays. Matching should be case-insensitive and should redact values for keys containing the sensitive terms above.

Use a stable redaction marker:

```json
"[redacted]"
```

## Capture Points

### Charger To Server

Record inbound OCPP calls before handler execution:

- source: charger
- target: server
- direction: inbound
- message type: call
- method: OCPP method
- payload: call params

Record handler result after successful execution:

- source: server
- target: charger
- direction: outbound
- message type: callResult
- method: OCPP method
- payload: response body

Record handler errors when thrown:

- source: server
- target: charger
- direction: outbound
- message type: callError
- method: OCPP method
- error fields and redacted error payload

### Server To Proxy

Record outbound proxy calls around `ProxyAuthorizationService.callTarget`:

- source: server
- target: proxy
- direction: outbound
- message type: call
- method: OCPP method
- payload: proxied OCPP params
- charger id and proxy target id populated

Record proxy responses:

- source: proxy
- target: server
- direction: inbound
- message type: callResult
- method: OCPP method
- payload: proxy response body

Record proxy errors:

- source: proxy
- target: server
- direction: inbound
- message type: callError
- method: OCPP method
- error fields populated

### Connections

Record charger connection and disconnection events:

- `connection`
- `disconnect`

Proxy connect/disconnect events should be added later when persistent proxy connections are implemented. For the current per-call proxy model, proxy call successes/errors are enough.

## Retention And Purging

Add environment variable:

```text
COMMUNICATION_LOG_RETENTION_HOURS=24
```

Behavior:

- Default retention is 24 hours.
- Values must be positive integers.
- Old rows are automatically purged when the server starts.
- Old rows are also purged opportunistically during runtime after journal inserts.
- Runtime purge should be throttled so cleanup does not run on every message.
- Manual purge API should be available to administrators.

Recommended runtime throttle:

- track the last purge time in memory
- run at most once every 10 minutes per server process
- delete rows where `created_at` is older than `now - retentionHours`

Manual purge endpoint:

```text
POST /api/communication-journal/purge
```

The endpoint should require admin auth and delete rows older than the configured retention window. It should return the configured retention and a deleted row count when feasible.

## API Design

Protected list endpoint:

```text
GET /api/communication-journal
```

Query parameters:

- `from`: ISO timestamp, optional, default `now - 24h`
- `to`: ISO timestamp, optional, default `now`
- `sourceType`
- `sourceId`
- `targetType`
- `targetId`
- `chargerId`
- `proxyTargetId`
- `ocppMethod`
- `messageType`
- `limit`: default 200, maximum 1000

Response:

```json
{
  "items": [
    {
      "id": "journal-id",
      "createdAt": "2026-06-19T10:00:00.000Z",
      "direction": "inbound",
      "sourceType": "charger",
      "sourceId": "8881",
      "targetType": "server",
      "targetId": "server",
      "chargerId": "8881",
      "proxyTargetId": null,
      "messageType": "call",
      "ocppMethod": "BootNotification",
      "transactionId": null,
      "idTag": null,
      "payload": {
        "chargePointVendor": "Smart EVSE"
      },
      "errorCode": null,
      "errorDescription": null,
      "correlationId": null
    }
  ],
  "retentionHours": 24
}
```

The API should parse `payload_json` and return `payload` as JSON. If parsing fails, return a safe object containing the raw string under a clearly named key.

## Admin UI

Add a protected `Communication` page.

Default view:

- Last 24 hours.
- Newest first.
- Limit 200 rows.

Table columns:

- Time
- Direction
- Source
- Target
- Method
- Message type
- Charger
- Proxy target
- Transaction
- Summary

Row expansion:

- Pretty-printed redacted JSON payload.
- Error code/description when present.

Filters:

- Source type
- Source id
- Target type
- Target id
- Charger id
- Proxy target
- OCPP method
- Message type
- Time range
- Refresh button
- Purge button

The page should not expose unredacted secrets.

## Testing Strategy

Backend tests:

- Inbound charger call creates `call` and `callResult` journal rows.
- Unknown/unsupported OCPP method creates a `callError` row.
- Proxy call creates outbound server-to-proxy and inbound proxy-to-server rows.
- Proxy failure creates a `callError` row.
- Redaction removes secret-like fields recursively.
- Journal list endpoint requires admin auth.
- Journal list endpoint filters by source/target and method.
- Automatic purge removes rows older than configured retention.
- Manual purge endpoint requires admin auth and removes old rows.

Frontend tests:

- `Communication` page appears only after admin auth.
- Default page renders recent communication rows.
- Source/target/method filters issue the expected API query.
- Expanded payload shows redacted JSON.
- Purge action calls the purge endpoint and refreshes the list.

## Risks And Mitigations

- Payload volume can grow quickly.
  - Mitigation: separate table, default 24-hour retention, automatic purge, bounded API limit.

- Sensitive data could be stored accidentally.
  - Mitigation: central redaction function used before every insert; tests for recursive redaction.

- UI could become slow with large payloads.
  - Mitigation: default 200 rows, maximum 1000 rows, expandable payloads only.

- Automatic purge could add latency during heavy message flow.
  - Mitigation: throttle runtime purge to at most once every 10 minutes.

## Acceptance Criteria

- Admins can open a separate `Communication` page.
- The page shows charger/server and server/proxy OCPP communication from the last 24 hours by default.
- Rows can be filtered by source and target.
- Rows include full redacted payloads.
- Secrets are redacted before storage.
- Communication rows older than `COMMUNICATION_LOG_RETENTION_HOURS` are automatically purged.
- Admins can manually trigger purge from the API and UI.
- Existing operational `logs` behavior remains unchanged.
