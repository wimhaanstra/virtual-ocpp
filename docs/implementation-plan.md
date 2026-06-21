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
- Per-proxy tag mapping: proxy targets can rewrite local charger idTags for outbound `Authorize` and `StartTransaction` calls while preserving local authorization/session tags.
- Remote stop support: operator action sends OCPP `RemoteStopTransaction` to connected chargers for active sessions while keeping local stale-record cleanup separate.
- Session reliability and runtime health: active-session audit warnings for likely missing `StopTransaction`, dashboard/session UI for stale-session context, and protected runtime proxy health based on persistent upstream socket state.
- Production Docker image: compiled backend and frontend in one container, persistent `/data` SQLite volume, healthcheck, compose example, and deployment documentation.
- Frontend component split: shared frontend types/helpers plus extracted app chrome, auth, dashboard, sessions, communication, and force-close modal components while preserving existing operator behavior.
- Live operator updates: authenticated SSE stream with replayed typed events, frontend live/stale indicator, and targeted REST refreshes for changed dashboard/session/log/protocol slices.
- Charger onboarding wizard: modal flow that shows the OCPP connection template/auth guidance, waits for a newly registered charger, lets the operator label it, and switches context to the detected charger.
- Sidebar and scope navigation: charger context, add-charger action, theme toggle, and sign out moved into the sidebar with grouped charger-scoped and global/admin navigation.
- Split tag management and tag access: global Tags page manages tag identities while charger-scoped Tag access grants or revokes existing tags for the selected charger.

## Next Candidate Slices

### Slice 5.10: Charger Management With Destructive Delete

Goal: add a global Chargers page for renaming and deleting registered chargers.

Scope:

- List registered chargers globally with connection state and useful timestamps.
- Allow editing the charger display label.
- Add destructive charger delete that removes all charger-owned data and closes runtime connections.
- Require admin password and exact charger id confirmation before deletion.

Acceptance criteria:

- Operators can rename a charger from the global Chargers page.
- Charger deletion rejects incorrect password or charger id confirmation.
- Successful charger deletion removes charger-owned proxy targets, tag grants, sessions, meter samples, logs, communication journal rows, mappings, and runtime connections.

### Slice 5.11: Operator UI Density Cleanup

Goal: reduce remaining bulk in admin tables, modals, and repeated controls now that the main workflows exist.

Scope:

- Tighten remaining table rows and action columns.
- Convert obvious text buttons to icon buttons with titles/labels.
- Revisit modal form section spacing after the charger wizard, proxy targets, and tags flows are all present.
- Keep the Charge Amber restrained visual direction and avoid adding new nested panels.

Acceptance criteria:

- Communication, sessions, tags, proxy targets, and dashboard controls fit comfortably on laptop-width screens.
- Table actions stay understandable with icon labels/tooltips.
- Forms align consistently across modals.
