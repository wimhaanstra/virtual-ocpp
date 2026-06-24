# Transactionless MeterValues Session Metadata Design

## Problem

The SmartEVSE production database shows real `MeterValues` during charging sessions, but those messages omit `transactionId`. For the session on charger `8881` that started on `2026-06-23 17:22:08`, the charger sent periodic `MeterValues` containing energy, power, current, phase current, and temperature, yet the stored `meter_samples.transaction_id` is `null`.

Current live charging stats look up meter samples by `chargerId + transactionId`, so transactionless samples are not shown on the charger dashboard or session views even though the data is present and forwarded upstream.

## Goals

- Support OCPP 1.6 `MeterValues` where `transactionId` is omitted.
- Show live and historical session metadata from transactionless samples when they can be matched unambiguously to an active or recent local session.
- Surface the measurands SmartEVSE already sends:
  - energy used from `Energy.Active.Import.Register`
  - current charging power from `Power.Active.Import`
  - current from `Current.Import`
  - per-phase current when `phase` is present
  - temperature from `Temperature`
- Keep exact stopped-session totals based on `StopTransaction.meterStop - meterStart` as the authoritative final energy total.
- Make the data source visible enough that operators can tell exact transaction-bound samples from connector/time matched samples.
- Add backend and frontend tests using the observed production pattern.

## Non-Goals

- Do not change how OCPP messages are forwarded to proxy targets in this slice.
- Do not create synthetic `transactionId` values inside the original stored payload.
- Do not rewrite historical production rows as part of the first implementation.
- Do not add graphing or long-term analytics yet.
- Do not implement OCPP 2.x meter translation in this slice.

## OCPP Context

The local `docs/ocpp-1.6.pdf` was added as the project reference for OCPP 1.6j. Local text extraction tooling is not currently available in this environment, so exact spec wording still needs to be quoted or cited after PDF extraction is available.

The current code already models `MeterValuesRequest.transactionId` as optional, and the production payload confirms this behavior:

```json
{
  "connectorId": 1,
  "meterValue": [
    {
      "timestamp": "2026-06-23T15:30:28Z",
      "sampledValue": [
        { "value": "480834", "context": "Sample.Periodic", "measurand": "Energy.Active.Import.Register", "unit": "Wh" },
        { "value": "3757.00", "context": "Sample.Periodic", "measurand": "Power.Active.Import", "unit": "W" }
      ]
    }
  ]
}
```

The implementation should treat omitted `transactionId` as valid OCPP 1.6 behavior, not as malformed input.

## Current Production Evidence

For charger `8881`, local transaction `1782211273551`:

- Session started: `2026-06-23 17:22:08`
- Session stopped: `2026-06-23 20:07:17`
- Stop reason: `EVDisconnected`
- Start meter: `480341 Wh`
- Stop meter: `486016 Wh`
- Final exact energy: `5.675 kWh`

Transactionless samples inside the session window:

- 19 sample timestamps between `17:30:28` and `20:00:30`
- 133 stored sample rows
- `Energy.Active.Import.Register`: `480834 Wh` to `486016 Wh`
- `Power.Active.Import`: max `3757 W`
- `Current.Import`: max `16.0 A`
- `Current.Import` phase values: `L1` up to `16.0 A`, `L2` and `L3` at `0 A`
- `Temperature`: `39 C` to `48 C`

## Recommended Approach

Use a derived association model at read time first:

1. Keep storing the original `transactionId` from `MeterValues` exactly as received.
2. When a sample has no `transactionId`, match it to a session by:
   - same `chargerId`
   - same `connectorId`
   - `sampledAt >= session.startedAt`
   - `sampledAt <= session.stoppedAt` for stopped sessions
   - `sampledAt <= now` for active sessions
3. Only use transactionless samples when exactly one matching session exists for that charger and connector at that sample time.
4. Prefer explicit transaction-bound samples over transactionless samples when both exist.
5. Return a `sampleAssociation` or `meterSource` field so the frontend can show whether values came from:
   - `transaction-id`
   - `connector-time-window`
   - `none`

This is the smallest safe step because it fixes existing data without a migration and reuses the pattern already present in force-close recovery, where latest energy samples are found by charger/connector/time when transaction id is missing.

## Rejected Alternatives

### Backfill `transaction_id` In `meter_samples`

Backfilling would make queries simpler, but it mutates historical protocol observations. It also needs careful conflict rules if overlapping sessions ever exist on one connector. This can be added later as an optional maintenance action after read-time matching has proven correct.

### Add A New `meter_sample_session_links` Table

A link table preserves raw samples and makes associations explicit, but it adds migration and lifecycle complexity. It is better suited if we later add analytics, graphs, or manual review for ambiguous samples.

### Infer By Charger Only

Matching by charger alone is unsafe for multi-connector chargers. Even if SmartEVSE is single-connector in current usage, the product supports connector ids and should keep that boundary.

## Backend Design

### Shared Sample Lookup Helper

Add a backend helper around `meter_samples` lookup, for example:

`findLatestSampleForSession(db, session, measurand, options)`

Inputs:

- `session`
- `measurand`
- `allowTransactionlessFallback`
- `includePhaseScopedFallback`
- optional `phase`

Lookup order:

1. Exact transaction id:
   - `charger_id = session.chargerId`
   - `transaction_id = session.transactionId`
   - matching `measurand`
   - unphased unless phase lookup is requested
2. Transactionless connector/time fallback:
   - `charger_id = session.chargerId`
   - `connector_id = session.connectorId`
   - `transaction_id is null`
   - matching `measurand`
   - `sampled_at >= session.startedAt`
   - if stopped: `sampled_at <= session.stoppedAt`
   - newest first
3. Optional phase-scoped fallback, only for energy/power when unphased values are absent.

Return:

```ts
{
  sample: MeterSampleRow | null;
  association: "transaction-id" | "connector-time-window" | "none";
}
```

### Charging Stats API

Update `GET /api/charging-stats` to use the shared lookup helper.

Add fields:

- `latestTemperatureC`
- `latestCurrentPhasesA`, for example `{ "L1": 16, "L2": 0, "L3": 0 }`
- `sampleAssociation`
- per-value association if useful later, but start with one top-level association based on the latest energy/power sample source

Keep existing fields:

- `latestMeterWh`
- `energyUsedWh`
- `latestPowerW`
- `latestCurrentA`
- `latestVoltageV`
- `latestSampleAt`

Energy calculation:

- Active session:
  - use latest meter sample minus `session.startMeterWh`
  - source label: latest sample, exactness depends on association
- Stopped session:
  - final total remains `stopMeterWh - startMeterWh`
  - MeterValues are supporting detail, not the authoritative final total

### Session Details API / Existing Sessions Endpoint

If the sessions endpoint remains intentionally compact, no API shape change is required for the first slice. The frontend can combine `/api/sessions` with `/api/charging-stats` for active sessions.

For historical stopped sessions, add a later endpoint or extension only when the UI needs historical sample ranges:

`GET /api/sessions/:id/meter-summary`

Initial response shape:

```json
{
  "sessionId": "...",
  "energyWh": {
    "exactStopDelta": 5675,
    "sampleDelta": 5182,
    "source": "stop-transaction"
  },
  "powerW": { "max": 3757, "averageSampled": 2018.5 },
  "currentA": { "max": 16, "phases": { "L1": 16, "L2": 0, "L3": 0 } },
  "temperatureC": { "min": 39, "max": 48, "averageSampled": 44.1 },
  "sampleWindow": {
    "firstSampleAt": "...",
    "lastSampleAt": "...",
    "sampleCount": 19,
    "association": "connector-time-window"
  }
}
```

This endpoint can be slice 2 if we want historical session metadata beyond the active dashboard.

### Normalization

Extend sample normalization for:

- `Temperature`
  - Celsius remains Celsius
  - Fahrenheit converts to Celsius if encountered
  - Kelvin converts to Celsius if encountered
- Phase current
  - keep existing per-row phase storage
  - expose phase map in API instead of collapsing phases into a fake total

## Frontend Design

### Charger Dashboard

For active sessions, show:

- current power
- energy used
- current
- temperature
- optional phase current line when phase values exist
- latest sample time
- source hint:
  - `MeterValues matched by transaction`
  - `MeterValues matched by connector/time`

Keep the current waiting state when no MeterValues are available.

### Sessions Page

For active sessions:

- show the same live values in the existing `Live` column where space allows
- keep expanded details for source labels and phase/temperature details

For stopped sessions:

- keep the row energy as exact `StopTransaction` delta
- later add “meter summary” in expanded details if the historical endpoint is implemented

## Ambiguity And Safety Rules

- If there are overlapping active sessions on the same charger and connector, do not attach transactionless samples to either session.
- If a transactionless sample falls outside any session window, store it but do not show it as session live data.
- If a sample has a transaction id that conflicts with the active session, do not use it as a fallback.
- If `connectorId` is missing, record it as `0` as today, but do not use connector/time fallback unless the session connector is also `0`.
- Communication journal keeps the raw OCPP payload exactly as received, with redaction rules unchanged.

## Observability

Add backend logs only for unusual cases, not every sample:

- ambiguous transactionless sample window
- transactionless sample could not be associated while a session is active on a different connector

Expose source through API rather than requiring log inspection.

## Test Strategy

### Backend

Add tests for:

- `MeterValues` with explicit `transactionId` still powers `/api/charging-stats`.
- `MeterValues` without `transactionId` but with same charger/connector/time window powers `/api/charging-stats`.
- Explicit transaction id samples win over transactionless fallback.
- Transactionless fallback ignores samples outside the session window.
- Transactionless fallback does not attach when two sessions overlap on the same charger/connector.
- Temperature normalization for Celsius.
- Phase current map for `L1`, `L2`, `L3`.

Use the production pattern:

- `StartTransaction`
- transactionless `MeterValues` with energy/power/current/phase current/temperature
- `StopTransaction` with final meter

### Frontend

Add tests for:

- Dashboard shows temperature when backend returns it.
- Dashboard/source detail indicates connector/time matched MeterValues.
- Sessions live column still shows compact power and energy.
- Waiting-for-MeterValues state remains when no sample exists.

### Manual Verification

After implementation, use the production database copy:

- Confirm transaction `1782211273551` can produce historical summary values.
- Confirm active transaction `1782211273552` can show live stats from transactionless samples.
- Confirm communication journal still shows the original transactionless payload.

## Implementation Slices

### Slice 1: Live Stats Fallback

- Add shared session sample lookup helper.
- Update `/api/charging-stats` to use connector/time fallback.
- Add `latestTemperatureC`, `latestCurrentPhasesA`, and `sampleAssociation`.
- Add backend tests.
- Update frontend types and charger dashboard rendering.
- Add frontend tests and docs.

### Slice 2: Historical Session Meter Summary

- Add `GET /api/sessions/:id/meter-summary`.
- Aggregate energy sample delta, max/average power, max/phase current, temperature range, sample count, first/last sample time.
- Show summary in expanded session details.
- Add tests and docs.

### Slice 3: Operator Diagnostics And Ambiguity

- Surface ambiguous transactionless samples in diagnostics or communication details.
- Add targeted logs for ignored ambiguous samples.
- Consider a maintenance report for unmatched samples.

## Acceptance Criteria

- Active sessions with transactionless `MeterValues` show live energy, power, current, and temperature.
- Existing explicit-transaction MeterValues behavior does not regress.
- Final stopped-session energy remains based on StopTransaction meter values.
- The UI distinguishes transaction-bound samples from connector/time matched samples.
- Backend tests cover the production SmartEVSE pattern.
- Documentation explains that OCPP 1.6 MeterValues may omit transaction id and how Virtual OCPP handles that safely.

## Open Questions

- Should Slice 1 include temperature on the compact dashboard immediately, or only in expanded live-session details?
- Should historical meter summaries be part of the sessions endpoint response or a separate endpoint loaded on row expansion?
- Once PDF extraction is available, add exact OCPP 1.6j references for `MeterValuesRequest.transactionId` and sampled value measurands.
