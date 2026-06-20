# Implementation Plan

This plan tracks the remaining implementation slices for Virtual OCPP. It should be updated when a slice is completed or when product behavior changes.

## Completed Slices

- Project foundation: npm workspaces, Fastify backend, Vite React frontend, SQLite/Drizzle baseline, auth, tests.
- OCPP local primary: Smart EVSE OCPP 1.6j websocket endpoint, core charger calls, session/meter/log persistence.
- Tag allowlist: protected tag CRUD API, frontend tag page, local authorization decisions.
- Proxy targets: protected proxy target CRUD API, frontend proxy target page, outbound credentials, station id, monitor-only and deny-capable modes.
- Proxy authorization and mirroring: deny-capable `Authorize`/`StartTransaction`, fail-open/fail-closed, mirrored OCPP calls, per-target transaction id mapping.
- Edit existing tags and proxy targets from the admin UI, including masked credential preservation and explicit credential clearing.
- Operator visibility APIs and pages for charger connections, sessions, and recent activity logs.
- Slice 5.1 Home Dashboard: protected default admin view with OCPP connection info, protocol/auth requirements without secrets, charger connection status, summary metrics, and quick links.
- Live charging stats: normalized meter sample storage plus dashboard active-session energy, power, current, voltage, elapsed time, and last sample timestamp.
- Communication journal: separate protected protocol trace table/API/page for redacted charger/server/proxy OCPP communication, source/target filtering, expandable payloads, and configurable automatic purge.
- Charger context and per-charger access: auto-register chargers, select charger context in the frontend, scope proxy targets to one charger, and require explicit per-charger tag access.
- Persistent proxy connections: reuse one upstream OCPP websocket connection per charger/proxy target, evict failed connections, and apply in-memory reconnect backoff while preserving fail-open/fail-closed behavior.
- OCPP charger simulator: repo-local CLI fake charger for demos and smoke tests, configurable charger/tag/meter values, optional tag seeding through the admin API, and full session flow.

## Next Candidate Slices

### Slice 5.4: Per-Proxy Tag Mapping

Goal: support replacing local tag IDs with configured outbound tag IDs per proxy target.

Scope:

- Store per-proxy tag mappings.
- Apply mappings to outbound `Authorize` and `StartTransaction`.
- Keep local authorization based on local tags.

Acceptance criteria:

- A local tag can map to different outbound tag IDs for different proxy targets.
- Missing mappings follow a documented fallback policy.
