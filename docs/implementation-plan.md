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

## Next Candidate Slices

### Slice 5.5: Frontend Component Split

Goal: break the current large React app file into focused components and hooks without changing operator behavior.

Scope:

- Extract the app shell, sidebar/topbar, dashboard, sessions, communication, proxy targets, tags, and modal forms into separate files.
- Extract shared formatting, API loading helpers, charger context helpers, and form state helpers into reusable modules.
- Keep current routes, visuals, tests, and API behavior stable.
- Add or adjust frontend tests around the extracted components where behavior risk is highest.

Acceptance criteria:

- `apps/web/src/App.tsx` becomes a thin composition layer instead of the main implementation file.
- Existing admin workflows still pass tests: dashboard, sessions, communication, tags, proxy targets, auth/logout, theme/sidebar preferences, and charger context routing.
- No UI redesign is included unless required by the extraction.

### Slice 5.6: Live Operator Updates

Goal: connect the frontend to the backend with a protected websocket/SSE-style live update channel so operators do not need manual refresh buttons for normal state changes.

Scope:

- Add an authenticated backend live updates endpoint for admin clients.
- Publish events when charger connections, sessions, charging stats, proxy health, active-session audit state, logs, or communication journal rows change.
- Update the frontend to subscribe after login and refresh only the affected data slices.
- Keep manual refresh actions as fallback controls.
- Handle reconnects, auth expiry, and browser tab resume without duplicate subscriptions.

Acceptance criteria:

- Dashboard charger state, live charging stats, proxy health, and missing-stop warnings update automatically after relevant backend events.
- Sessions and Communication pages update without requiring operator refresh for new session/log/protocol rows.
- If the live channel disconnects, the UI shows a small stale/live indicator and retries.
- Tests cover backend event publishing and frontend subscription/update behavior.

### Slice 5.7: Charger Onboarding Wizard

Goal: add a guided modal workflow for adding a charger by waiting for a new charger connection and then helping the operator configure it.

Scope:

- Add a top-level "Add charger" action that opens a modal wizard.
- Show the exact OCPP websocket URL, protocol, and optional Basic Auth guidance.
- Wait for an unassigned/new charger to connect and display candidate charger ids as they appear.
- Let the operator confirm the detected charger, optionally set a label, then continue to initial tag/proxy-target setup.
- Use live updates when Slice 5.6 is available; otherwise use a temporary polling fallback.
- Avoid creating placeholder chargers that never connected unless a later explicit manual-registration option is designed.

Acceptance criteria:

- An operator can open the wizard, point a charger at Virtual OCPP, see the charger appear, confirm it, and end with that charger selected as context.
- The wizard clearly distinguishes newly detected chargers from already known chargers.
- The flow works when there are no chargers yet.
- The wizard can be cancelled without leaving partial configuration behind.
