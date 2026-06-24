# OCPP Diagnostics And Configuration Slice Design

## Problem

Virtual OCPP currently has only one operator-triggered server-to-charger OCPP command in the protected API: `RemoteStopTransaction`.

The repo already contains a reusable charger command transport in [apps/server/src/ocpp/charger-command-service.ts](/Volumes/Projects/sorted-bits/virtual-ocpp/apps/server/src/ocpp/charger-command-service.ts), including typed methods for `GetConfiguration`, `ChangeConfiguration`, and `TriggerMessage`, but there is no protected route or frontend workflow that uses them.

That leaves operators without a safe way to:

- inspect charger configuration that affects heartbeat cadence, meter cadence, and stop behavior
- request an immediate heartbeat, status refresh, boot notification, firmware status update, or current meter snapshot
- diagnose whether a charger can respond to standard OCPP diagnostics/configuration calls without dropping into ad hoc tooling

At the same time, Virtual OCPP must keep secrets and vendor-specific sensitive data out of frontend responses, logs, examples, and communication exports. An unrestricted "dump all charger configuration" feature would violate that boundary too easily.

## Goals

- Add a protected charger-scoped admin surface for `GetConfiguration`, `ChangeConfiguration`, and `TriggerMessage`.
- Reuse the existing websocket command path and communication journal instead of adding a second transport.
- Keep the slice safe by exposing only documented non-secret configuration keys and only a small set of supported trigger messages.
- Make command outcomes operator-usable: disconnected charger, rejected key, reboot-required result, and trigger follow-up ambiguity should all be explicit.
- Keep the broader future diagnostics page free to build on these controls instead of redefining them.

## Non-Goals

- Do not add generic arbitrary OCPP method sending.
- Do not add `Reset`, `GetDiagnostics`, `UnlockConnector`, or firmware download/install control in this slice.
- Do not expose a raw unrestricted `GetConfiguration` call that can return vendor-specific secret-like keys.
- Do not persist a separate historical configuration snapshot table in the first iteration.
- Do not expand this slice into `StopTransaction.transactionData` persistence or billing reconstruction.

## Verified Current Boundary

These points are verified from the working tree:

- [apps/server/src/ocpp/server.ts](/Volumes/Projects/sorted-bits/virtual-ocpp/apps/server/src/ocpp/server.ts) registers handlers for `BootNotification`, `Heartbeat`, `FirmwareStatusNotification`, `Authorize`, `StartTransaction`, `StopTransaction`, `StatusNotification`, and `MeterValues`.
- The same file falls through to a `NotImplemented` OCPP error for other charger-originated methods and records that outcome in the communication journal and logs.
- [apps/server/src/ocpp/charger-command-service.ts](/Volumes/Projects/sorted-bits/virtual-ocpp/apps/server/src/ocpp/charger-command-service.ts) already supports outbound `GetConfiguration`, `ChangeConfiguration`, `TriggerMessage`, and `RemoteStopTransaction` calls with communication-journal recording and a `5000 ms` call timeout.
- [apps/server/src/visibility.ts](/Volumes/Projects/sorted-bits/virtual-ocpp/apps/server/src/visibility.ts) exposes the session-scoped `RemoteStopTransaction` admin route plus charger-scoped diagnostics/configuration command routes.
- [apps/server/src/ocpp/types.ts](/Volumes/Projects/sorted-bits/virtual-ocpp/apps/server/src/ocpp/types.ts) already includes minimal request/response types for `GetConfiguration`, `ChangeConfiguration`, and `TriggerMessage`.

## OCPP 1.6j Context

The local project reference [docs/ocpp-1.6.pdf](/Volumes/Projects/sorted-bits/virtual-ocpp/docs/ocpp-1.6.pdf) defines the relevant contract:

- `GetConfiguration.req` accepts an optional `key[]`; when omitted, the charger may return all known keys.
- `GetConfiguration.conf` returns `configurationKey[]` with `key`, `readonly`, and optional `value`, plus `unknownKey[]`.
- `ChangeConfiguration.req` sends one `key` plus one string `value`.
- `ChangeConfiguration.conf.status` is one of `Accepted`, `Rejected`, `RebootRequired`, or `NotSupported`.
- `TriggerMessage.req` accepts `requestedMessage` plus optional `connectorId`.
- `TriggerMessage.conf.status` is one of `Accepted`, `Rejected`, or `NotImplemented`.
- `TriggerMessage` is for current-state messages only. The standard explicitly leaves `StartTransaction` and `StopTransaction` out of this mechanism.
- `StopTransaction.req` may include optional `transactionData`, which is a `MeterValue[]` container relevant for billing details.

## Approved Approach

### Protected API Surface

Add charger-scoped protected admin routes:

- `POST /api/chargers/:chargerId/commands/get-configuration`
- `POST /api/chargers/:chargerId/commands/change-configuration`
- `POST /api/chargers/:chargerId/commands/trigger-message`

All three routes should:

- require the existing admin session
- require the charger to be currently connected
- use `ChargerCommandService`
- preserve the existing command timeout and journal recording path
- return a clear `409`-style protected error when the charger is disconnected

Suggested response shapes:

```json
{
  "chargerId": "SIM-001",
  "fetchedAt": "2026-06-24T09:30:00.000Z",
  "configurationKey": [
    { "key": "HeartbeatInterval", "readonly": false, "value": "60" }
  ],
  "unknownKey": []
}
```

```json
{
  "chargerId": "SIM-001",
  "key": "HeartbeatInterval",
  "value": "300",
  "status": "Accepted",
  "changedAt": "2026-06-24T09:31:00.000Z"
}
```

```json
{
  "chargerId": "SIM-001",
  "requestedMessage": "Heartbeat",
  "connectorId": null,
  "status": "Accepted",
  "triggeredAt": "2026-06-24T09:32:00.000Z"
}
```

The API may wrap the raw OCPP responses with metadata, but it should not rename or reinterpret the charger's `status` field.

### Configuration Registry

Do not expose arbitrary requested keys in the first slice. Instead, add a backend-owned registry of documented non-secret keys.

Initial read allowlist:

- `ClockAlignedDataInterval`
- `ConnectorPhaseRotation`
- `HeartbeatInterval`
- `MeterValueSampleInterval`
- `MeterValuesAlignedData`
- `MeterValuesSampledData`
- `NumberOfConnectors`
- `StopTxnAlignedData`
- `StopTxnSampledData`
- `SupportedFeatureProfiles`

Initial write allowlist:

- `ClockAlignedDataInterval`
- `HeartbeatInterval`
- `MeterValueSampleInterval`
- `MeterValuesAlignedData`
- `MeterValuesSampledData`
- `StopTxnAlignedData`
- `StopTxnSampledData`

Registry metadata should include:

- key name
- read allowed
- write allowed
- short operator description
- light local validation rule
- whether a reboot may reasonably be expected

This registry is the product safety boundary. Unknown or non-allowlisted keys should be rejected by the admin API before any OCPP command is sent.

### Local Validation Rules

Use narrow local validation only:

- integer keys: decimal string for positive integer values
- boolean-style keys: normalize to lowercase `true` or `false`
- `MeterValuesSampledData`: non-empty comma-separated string, trimmed, length-bounded, with final charger validation still authoritative

Do not try to fully emulate charger-specific validation rules. The charger remains authoritative through `Accepted`, `Rejected`, `RebootRequired`, or `NotSupported`.

### TriggerMessage Policy

Allow only the triggerable messages that fit the current product surface:

- `BootNotification`
- `DiagnosticsStatusNotification`
- `FirmwareStatusNotification`
- `Heartbeat`
- `MeterValues`
- `StatusNotification`

Operator copy must be explicit that:

- `Accepted` means the charger intends to send the requested message
- the triggered follow-up may arrive slightly later
- a naturally occurring matching message may satisfy the trigger

The UI should link directly to the communication journal filtered by charger and OCPP method so operators can confirm the follow-up payload.

### Frontend Workflow

Add a charger-scoped diagnostics/configuration area. It can be a dedicated page or a charger diagnostics section, but it should stay separate from global settings because these commands are runtime charger interactions, not Virtual OCPP server configuration.

Minimum UI pieces:

- configuration cards or table rows for the allowlisted keys
- per-key edit action only when the key is locally writable
- a compact trigger-actions panel for heartbeat, status, boot, firmware status, and meter values
- recent result banner or inline status per action
- direct link into the communication journal for the relevant command/result pair

Do not show raw vendor-specific configuration blobs or secret-like values. If the UI allows typed keys, the backend allowlist remains authoritative and rejects non-allowlisted values before any OCPP command is sent.

### Communication And Logging

Reuse the existing communication journal behavior in `ChargerCommandService`.

Requirements:

- outbound server call, inbound charger result, and inbound charger error stay journaled with one correlation id
- frontend responses and exported communication data keep the current redaction boundary
- API-level validation failures should be logged as operator misuse or policy rejection, but they should not create fake OCPP command rows

### No New Persistence Table In Slice 1

The first slice does not need a configuration snapshot table.

Rationale:

- the command/result journal already captures what was sent and what the charger returned
- keeping results transient avoids prematurely treating charger configuration as Virtual OCPP-owned state
- if operators later need last-known summarized configuration, that can be added as a read-model slice after real device usage confirms the need

## StopTransaction.transactionData Follow-Up

`StopTransaction.req` may include `transactionData`, and the current runtime does not model or persist it structurally.

Current repo behavior:

- the raw incoming call payload is journaled before handler execution
- the typed handler and session persistence logic do not read `transactionData`
- meter persistence today is still driven by `MeterValues` plus `StartTransaction` and `StopTransaction.meterStop`

Follow-up slice questions:

- Should `transactionData` be persisted into the existing meter-sample model, a separate stop-detail table, or only the communication journal?
- How should duplicate measurements be handled when the same samples already arrived through `MeterValues`?
- Which operator view actually needs those stop-time billing details?
- How should exact stop totals versus supporting stop snapshots be labeled?

This follow-up should stay separate so the first diagnostics/configuration slice remains focused and safe.

## Risks And Mitigations

- Secret leakage through vendor-specific configuration keys: block arbitrary keys and expose only a reviewed allowlist.
- Confusing trigger outcomes: keep `Accepted` semantics explicit and link to the journal for confirmation.
- Over-promising local validation: keep validation shallow and let the charger remain authoritative.
- UI overlap with the later diagnostics view: treat this slice as the command/config foundation that the broader diagnostics view reuses later.

## Test Strategy

- Backend tests:
  - disconnected charger returns a clear protected error for all three routes
  - `GetConfiguration` forwards only allowlisted keys and returns charger `unknownKey` values unchanged
  - `ChangeConfiguration` blocks non-allowlisted keys locally
  - `ChangeConfiguration` passes through `Accepted`, `Rejected`, `RebootRequired`, and `NotSupported`
  - `TriggerMessage` passes through `Accepted`, `Rejected`, and `NotImplemented`
  - communication-journal rows are recorded for successful outbound calls and charger results/errors
- Frontend tests:
  - writable versus readonly configuration rows render correctly
  - blocked-key or disconnected-charger errors are shown clearly
  - trigger actions show the result status and follow-up explanation
  - communication-journal link targets the charger and relevant OCPP method
- Verification commands:
  - `npm run test --workspace=@virtual-ocpp/server`
  - `npm run test --workspace=@virtual-ocpp/web`
  - `npm run lint --workspace=@virtual-ocpp/server`
  - `npm run lint --workspace=@virtual-ocpp/web`
  - `npm run build --workspace=@virtual-ocpp/server`
  - `npm run build --workspace=@virtual-ocpp/web`

## Acceptance Criteria

- The repo has protected charger-scoped admin flows for `GetConfiguration`, `ChangeConfiguration`, and `TriggerMessage`.
- The configuration surface is allowlisted and does not expose arbitrary vendor-specific keys or secret-like values.
- Triggered current-state messages are operator-visible through both direct action results and the redacted communication journal.
- Disconnected chargers, unsupported keys, readonly keys, and reboot-required outcomes are explicit in backend responses and UI copy.
- `StopTransaction.transactionData` is documented as deferred follow-up work rather than silently ignored in the slice spec.
