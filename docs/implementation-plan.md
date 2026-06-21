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
- Charger management with destructive delete: global Chargers page lists the charger registry, supports label edits, and requires admin password plus exact charger id confirmation before deleting charger-owned data and runtime connections.
- Operator UI density cleanup: repeated table and page-level utility actions use compact icon buttons with descriptive titles/accessibility labels, table/action spacing is tighter, the sidebar has a compact title-level collapse button plus bottom-aligned global links and wider footer controls, and `/` is now a clean global dashboard while the charger-specific dashboard lives at `/charger-dashboard`.
- Charger dashboard simplification: charger-specific dashboard replaces the bulky ingress panel with a compact hero backed by protected stored session totals, and upstream proxy health is shown as a compact target/state list.
- Proxy target form polish: modal sections align fields without inline description offsets, stored credentials use masked inputs with dirty-state updates, clear checkboxes are removed, and tag mappings live as the final form section.

## Next Candidate Slices

### First-run operator onboarding

Build a guided first-run setup flow for a fresh Virtual OCPP installation. The flow should open automatically when an authenticated admin has not completed onboarding yet, and it should remain available as a manual action later.

Scope:

- Explain the local-primary model in operator terms: charger connects to Virtual OCPP, Virtual OCPP authorizes locally, and selected proxy targets receive mirrored/controlling OCPP traffic.
- Reuse the existing charger onboarding mechanics to show the OCPP URL, protocol/auth details, wait for a newly registered charger, label it, and switch to that charger context.
- Let the operator optionally create a global tag during onboarding.
- Let the operator grant that tag access to the newly detected charger before finishing.
- Let the operator optionally create the first proxy target for the detected charger, including URL, username, password, station id, enabled state, mode, and outage policy.
- Show a clear completion state with next actions: test authorization, review proxy health, and inspect communication logs.
- Persist onboarding completion so the wizard does not reappear after refresh, while still allowing operators to relaunch it from the Settings page for testing or repeat walkthroughs.

Acceptance criteria:

- A first-time authenticated admin sees the onboarding flow automatically when no completed onboarding marker exists.
- The flow can be skipped or completed, and either choice prevents repeated automatic popups.
- A new charger can be detected through the same registry polling/live-update pattern as the current charger wizard.
- A tag can be created or an existing tag can be selected during onboarding.
- The chosen tag can be granted to the detected charger before finishing.
- A proxy target can be skipped or created for the detected charger before finishing.
- The Settings page exposes a manual "Run onboarding" action that opens the same flow even after onboarding was completed or skipped.
- The final state routes the operator to the charger dashboard for the new charger.
- Frontend tests cover first-run opening, skip/complete persistence, manual relaunch from Settings, charger detection, tag creation/selection, tag grant submission, and optional proxy target creation.
- Operator documentation explains when onboarding appears and how to rerun the setup manually.
