# Multi-Charger Proxy Assignments Design

## Problem

Virtual OCPP currently treats proxy targets as global. Every enabled proxy target receives mirrored traffic from every connected charger. That works for a single Smart EVSE, but it breaks as soon as the service manages more than one charger or simulator because each charger may need a different upstream station identity, deny policy, and proxy set.

Persistent upstream proxy connections also need a charger/proxy assignment model first. Without it, the connection manager would not know which upstream sockets to keep open for each charger identity.

## Goals

- Support multiple local charger IDs.
- Allow each charger to have zero, one, or many proxy assignments.
- Allow the same proxy target to be reused by multiple chargers.
- Move runtime station identity, deny mode, and outage policy to the charger/proxy assignment.
- Keep proxy targets as reusable upstream definitions: name, URL, and credentials.
- Make assignments manageable from the protected admin interface.
- Keep the next persistent proxy connection slice clean by introducing the routing table now.

## Non-Goals

- Do not implement persistent upstream proxy sockets in this slice.
- Do not implement a full charger inventory/profile table yet.
- Do not implement the simulator in this slice.
- Do not implement per-proxy tag mapping in this slice.
- Do not preserve old global proxy routing behavior. Existing proxy targets can be re-assigned manually.

## Current Context

- Local chargers connect to `/ocpp/:chargerId`.
- Charger connection history already stores `charger_id`.
- Proxy targets are stored in `proxy_targets`.
- Proxy forwarding currently loads all enabled `proxy_targets`.
- The frontend already has a protected Proxy targets page and read-only charger visibility.

## Approved Approach

Add a `charger_proxy_assignments` table keyed by local `charger_id` and `proxy_target_id`.

At runtime, `ProxyAuthorizationService` forwards only through enabled assignments for the active local charger. If a charger has no assignments, no proxy target is called.

Proxy targets remain reusable upstream definitions. Assignment rows provide the runtime policy and the upstream station identity for a specific local charger.

## Data Model

Add table:

```text
charger_proxy_assignments
```

Columns:

- `id`: text primary key
- `charger_id`: local charger identity, matching `/ocpp/:chargerId`
- `proxy_target_id`: target in `proxy_targets`
- `enabled`: assignment enabled flag
- `station_id`: optional upstream OCPP station identity for this charger/target
- `mode`: `monitor-only` or `deny-capable`
- `outage_policy`: `fail-open` or `fail-closed`
- `created_at`: timestamp
- `updated_at`: timestamp

Indexes:

- unique `charger_id`, `proxy_target_id`
- `charger_id`
- `proxy_target_id`

`proxy_targets.station_id`, `proxy_targets.mode`, and `proxy_targets.outage_policy` may remain for now to keep the schema migration small, but runtime routing should use assignment values.

## API

Protected routes:

```text
GET /api/charger-proxy-assignments
POST /api/charger-proxy-assignments
PATCH /api/charger-proxy-assignments/:id
DELETE /api/charger-proxy-assignments/:id
```

Create payload:

```json
{
  "chargerId": "8881",
  "proxyTargetId": "proxy-id",
  "enabled": true,
  "stationId": "8888",
  "mode": "monitor-only",
  "outagePolicy": "fail-open"
}
```

Update payload:

```json
{
  "enabled": false,
  "stationId": null,
  "mode": "deny-capable",
  "outagePolicy": "fail-closed"
}
```

List responses include the proxy target name so the UI does not need to guess labels:

```json
{
  "id": "assignment-id",
  "chargerId": "8881",
  "proxyTargetId": "proxy-id",
  "proxyTargetName": "EVCC",
  "enabled": true,
  "stationId": "8888",
  "mode": "monitor-only",
  "outagePolicy": "fail-open",
  "createdAt": "2026-06-19T20:00:00.000Z",
  "updatedAt": "2026-06-19T20:00:00.000Z"
}
```

## Runtime Routing

For each proxied OCPP call:

1. Load enabled assignments for the local charger ID.
2. Join to enabled proxy targets.
3. For each assignment, connect to the proxy target URL.
4. Use `assignment.station_id` as upstream OCPP identity when present, otherwise use the local charger ID.
5. Use `assignment.mode` to decide whether a proxy response can deny local charging.
6. Use `assignment.outage_policy` for unavailable deny-capable proxies.
7. Store transaction mappings against the proxy target ID as today.

If no enabled assignments exist for the charger, no proxy calls are made.

## Admin UI

Add assignment management to the proxy target workflow:

- Create an assignment by entering a local charger ID, choosing a proxy target, and setting station ID/mode/outage policy.
- Edit enabled state, station ID, mode, and outage policy.
- Delete assignments.
- Show assignments in a table grouped or sortable by charger and proxy target.
- Keep credentials managed only on proxy targets.

The charger ID field should allow free text so assignments can be created before a charger connects. Known charger IDs from visibility APIs can be added later as suggestions.

## Tests

Backend:

- Assignment CRUD requires admin auth.
- Create/list/update/delete assignment works and validates proxy target existence.
- Duplicate charger/proxy assignment is rejected.
- Proxy forwarding uses only assignments for the active charger.
- A charger with no assignments does not call any proxy target.
- Assignment station ID overrides the upstream OCPP identity.
- Assignment mode/outage policy controls deny and outage decisions.

Frontend:

- Assignment section loads after authentication.
- Create form posts the expected payload.
- Edit flow preserves assignment state and can clear station ID.
- Delete flow calls the expected endpoint.

## Follow-Up Slice

Persistent upstream proxy connections should come next.

That slice should use `charger_proxy_assignments` as the connection source of truth and maintain one managed upstream connection per enabled charger/proxy assignment identity. It should add connect/disconnect/reconnect journal rows and keep fail-open/fail-closed behavior deterministic while connections are down.

## Acceptance Criteria

- Existing proxy targets no longer receive charger traffic until assigned to that charger.
- One charger can be assigned to multiple proxy targets.
- One proxy target can be assigned to multiple charger IDs with different station IDs.
- OCPP forwarding, denial, and outage behavior use assignment-level settings.
- Admin users can manage assignments from the frontend.
- Tests cover backend routing and frontend assignment management.
