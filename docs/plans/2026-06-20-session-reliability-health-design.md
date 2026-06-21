# Session Reliability And Health Design

## Problem

Some real charger flows leave operators without enough context to act safely:

- A charger can report connector status such as `Available` while a local charging session remains active because no `StopTransaction` arrived.
- Dashboard proxy health is currently inferred from recent logs instead of the live upstream proxy connection state.
- Active sessions do not show enough audit detail to understand the latest meter value, proxy mapping state, or likely missing-stop condition before force closing.

## Goals

- Surface a warning when charger status suggests a session probably ended but no `StopTransaction` was received.
- Add a backend proxy-health API based on current in-memory proxy connection state and recent runtime timestamps.
- Add active-session audit details so operators can see latest meter sample, force-close meter source, proxy mappings, and warnings.
- Keep the slice advisory and observable; do not auto-close sessions from status notifications.
- Update tests, specs, and docs in the same slice.

## Non-Goals

- Do not add a persistent proxy uptime/history model.
- Do not auto-force-close sessions.
- Do not change OCPP authorization behavior.
- Do not redesign the whole dashboard or Sessions page layout.

## Approved Approach

### Missing StopTransaction Warning And Audit

The backend will expose a derived active-session audit endpoint. It will inspect active sessions, charger connection state, recent logs, latest connector status, and latest meter samples.

Endpoint:

`GET /api/active-session-audit?chargerId=<chargerId>`

Response shape:

```json
{
  "summary": {
    "activeSessions": 1,
    "flaggedSessions": 1
  },
  "items": [
    {
      "sessionId": "uuid",
      "chargerId": "8881",
      "connectorId": 1,
      "transactionId": 1781936177402,
      "startedAt": "2026-06-20T06:24:21.000Z",
      "chargerConnected": true,
      "latestStatus": "Available",
      "latestStatusAt": "2026-06-20T09:00:59.000Z",
      "latestMeterSampleAt": "2026-06-20T07:39:22.000Z",
      "latestMeterWh": 446404,
      "warnings": [
        {
          "code": "connector_available_without_stop_transaction",
          "severity": "warn",
          "message": "Connector is Available while the session is still active."
        }
      ],
      "recommendedAction": "force_close_preview"
    }
  ]
}
```

Initial warning rules:

- `Available`
- `Finishing`
- charger disconnected while the session remains active
- accepted remote stop older than a short grace window while the session remains active

`Faulted` is not included initially because some chargers fault while a transaction is still recoverable. This can be added later if real-device evidence supports it.

Warnings are advisory only. They do not auto-close sessions and they do not synthesize OCPP messages by themselves.

### Proxy Health API

`ProxyAuthorizationService` will expose a read-only health method. It will combine:

- enabled proxy target rows for the charger
- in-memory connection entry for each target
- reconnect backoff state
- last successful call timestamp
- last failure timestamp
- last lifecycle event timestamp where available

Endpoint:

`GET /api/proxy-health?chargerId=<chargerId>`

Response shape:

```json
{
  "chargerId": "8881",
  "summary": {
    "total": 1,
    "connected": 1,
    "backoff": 0,
    "waitingForCharger": 0,
    "disabled": 0
  },
  "targets": [
    {
      "proxyTargetId": "uuid",
      "name": "TapElectric",
      "chargerId": "8881",
      "enabled": true,
      "mode": "monitor-only",
      "outagePolicy": "fail-open",
      "connected": true,
      "state": "connected",
      "detail": "Last call accepted",
      "upstreamIdentity": "8881",
      "hadSuccessfulConnection": true,
      "lastConnectedAt": "2026-06-20T09:00:00.000Z",
      "lastDisconnectedAt": null,
      "lastSuccessAt": "2026-06-20T09:00:00.000Z",
      "lastFailureAt": null,
      "nextReconnectAt": null,
      "lastErrorCode": null
    }
  ]
}
```

State values:

- `disabled`
- `waiting_for_charger`
- `connected`
- `connecting`
- `backoff`
- `disconnected`
- `unknown`

The frontend will replace log-derived proxy health on the dashboard with this API. Logs remain available in Communication for historical evidence.

### Frontend Workflow

The Home dashboard will load both `/api/proxy-health` and `/api/active-session-audit`.

- Existing proxy health panel uses runtime proxy-health data instead of log-derived heuristics.
- Add a compact Session audit panel showing flagged active sessions only.
- Session audit actions:
  - Remote stop when the charger is connected and no remote stop is already pending.
  - Force close when the charger is disconnected, connector is Available/Finishing, or remote stop is already pending.

The Sessions page will also load audit data and show a compact warning pill for flagged active rows, with latest meter and proxy mapping context available inline. The existing force-close preview remains the final confirmation before sending synthesized `StopTransaction`.

## Risks And Mitigations

- False positives from charger status transitions: warnings are advisory only and do not mutate sessions.
- Runtime proxy health resets after server restart: UI labels it as current runtime health, not historical uptime.
- API response size: audit enrichment is limited to active sessions and the recent session limit.
- Duplicated meter-sample logic: reuse existing visibility helpers where possible; avoid larger refactors in this slice.

## Test Strategy

- Backend tests:
  - `/api/active-session-audit` flags `StatusNotification Available` with an active same-connector session.
  - `/api/active-session-audit` flags charger disconnected with active sessions.
  - `/api/active-session-audit` flags remote stop accepted but no later `StopTransaction`.
  - proxy-health endpoint reports connected/backoff/unknown states from the proxy service.
- Frontend tests:
  - dashboard renders proxy health from `/api/proxy-health`.
  - dashboard renders flagged session audit items.
  - Sessions page shows missing-stop warning and audit details.
  - force-close preview remains available from the warning flow.
- Verification:
  - `npm run test --workspaces --if-present -- --run`
  - `npm run lint`
  - `npm run build --workspace=apps/server`
  - `npm run build --workspace=apps/web`
  - `git diff --check`

## Acceptance Criteria

- Operators can identify active sessions that likely missed `StopTransaction`.
- Operators can see the latest meter value and proxy mappings before force closing.
- Dashboard proxy health no longer depends on log inference.
- No session is closed automatically by the new warning detection.
- All changes are documented, tested, and committed as one slice.
