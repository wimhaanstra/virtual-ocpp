# Charger Context Design

## Problem

The admin interface currently treats proxy targets as a shared library and uses charger assignments to route traffic. The desired operator workflow is charger-first: when a charger connects, Virtual OCPP should register it, the frontend should switch context to that charger, and all operational views should show data for that charger. Tags remain global records, but a tag should only authorize chargers it has explicit access to.

## Goals

- Register chargers automatically when they connect to the OCPP backend.
- Let the admin UI select an active charger context.
- Scope proxy targets to one charger instead of managing global proxies.
- Scope sessions, activity, and communication views to the selected charger.
- Keep tags globally managed.
- Require explicit tag-to-charger access before a tag can authorize charging on that charger.

## Non-Goals

- Do not preserve old global proxy behavior.
- Do not build the simulator in this slice.
- Do not implement persistent upstream proxy connections in this slice.
- Do not build role-based admin accounts.

## Data Model

Add `chargers`:

- `id`: local OCPP charger id, primary key.
- `label`: optional operator label.
- `first_seen_at`: first connection timestamp.
- `last_seen_at`: most recent connection or OCPP message timestamp.
- `last_boot_at`: most recent BootNotification timestamp.
- `charge_point_vendor`: optional BootNotification vendor.
- `charge_point_model`: optional BootNotification model.
- `firmware_version`: optional BootNotification firmware.
- `enabled`: charger enabled flag.
- `created_at`: creation timestamp.
- `updated_at`: update timestamp.

Add `tag_charger_access`:

- `id`: primary key.
- `tag_id`: global tag id.
- `charger_id`: charger id.
- `enabled`: access flag.
- `created_at`: creation timestamp.
- `updated_at`: update timestamp.

Add `proxy_targets.charger_id`.

Runtime proxy routing reads `proxy_targets` where `charger_id` matches the active charger id and `enabled` is true. `charger_proxy_assignments` is no longer part of runtime routing.

## API

Protected charger registry:

- `GET /api/chargers`: registered chargers with active connection state.
- `PATCH /api/chargers/:id`: update label and enabled state.

Protected proxy targets:

- `GET /api/proxy-targets?chargerId=...`: list targets for a charger.
- `POST /api/proxy-targets`: create a target for `chargerId`.
- `PATCH /api/proxy-targets/:id`: update a charger-scoped target.
- `DELETE /api/proxy-targets/:id`: delete a charger-scoped target.

Protected tag access:

- `GET /api/tags`: list global tags with optional access rows.
- `PUT /api/tags/:id/chargers/:chargerId`: grant or update access.
- `DELETE /api/tags/:id/chargers/:chargerId`: revoke access.

Visibility filters:

- `GET /api/sessions?chargerId=...`
- `GET /api/logs?chargerId=...`
- `GET /api/charger-connections?chargerId=...`
- `GET /api/communication-journal?chargerId=...` already exists.

## OCPP Behavior

When a charger connects:

1. Upsert it into `chargers`.
2. Record the connection history as before.
3. Mark recent timestamps.

On BootNotification:

1. Update `last_boot_at`.
2. Store vendor, model, and firmware fields.

Authorization:

1. Find the global tag by UUID.
2. Reject when the tag is missing or disabled.
3. Reject when there is no enabled `tag_charger_access` row for the current charger.
4. Continue to proxy deny checks only after local charger-specific tag access is accepted.

Proxy routing:

1. Load enabled proxy targets for the current charger id.
2. Use the target station id when set; otherwise the local charger id.
3. Use target mode and outage policy.

## Frontend

Add a charger context selector near the top of the protected interface.

When a charger is selected:

- Home shows selected charger connection details.
- Proxy targets list/create/edit/delete only for selected charger.
- Sessions list only selected charger sessions.
- Activity list only selected charger connections/logs.
- Communication defaults to selected charger filtering.
- Tags remain global, but show and toggle access for the selected charger.

If no charger is selected:

- Show global dashboard guidance.
- Disable charger-scoped create actions.
- Keep global tag CRUD available, but charger access toggles require a selected charger.

## Acceptance Criteria

- A charger connecting to `/ocpp/:chargerId` appears in `GET /api/chargers`.
- A tag does not authorize charging on any charger until explicitly granted to that charger.
- A proxy target created for charger A is not called by charger B.
- The frontend selected charger context scopes proxy targets, sessions, activity, and communication.
- The frontend can grant and revoke selected-charger access for global tags.
- Tests cover auto-registration, tag access authorization, charger-scoped proxy routing, and frontend context behavior.
