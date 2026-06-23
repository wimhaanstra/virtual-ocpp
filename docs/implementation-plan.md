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
- Settings foundation and onboarding state: global Settings page, protected persisted onboarding settings API, SQLite migration, completion/skip/reset actions, and manual onboarding relaunch entry point.
- First-run onboarding shell: pending onboarding state automatically opens the charger setup wizard after admin login, first-run cancel marks onboarding skipped, first-run completion marks onboarding completed, and manual Settings relaunch leaves stored state unchanged.
- First-run onboarding setup steps: onboarding uses a multi-step flow to detect and label the charger, create or select a tag, grant it to the detected charger, optionally create a charger-scoped proxy target, and only then mark onboarding completed.
- Documentation refresh: project, development, and deployment docs now describe current onboarding, charger context, tag access, proxy target, communication journal, simulator, live-update, Docker, and destructive charger delete behavior.
- Deployment hardening: production placeholder secrets are rejected, SQLite startup failures include the resolved database path, `/ready` verifies database access, the Docker healthcheck uses readiness, and deployment docs explain health versus readiness.
- Simulator smoke flow: `--smoke` simulator mode and `npm run smoke:simulator` provide a fast repeatable charger session that ensures tag access, sends meter samples, stops the transaction, and prints a success marker.
- OCPP version compatibility research: documented why OCPP 1.6j to newer OCPP support should be an explicit upstream adapter layer, with OCPP 2.0.1 as the first future target and unsupported mappings visible to operators.
- Manual proxy stop recovery: stopped local sessions can preview and send a one-off `StopTransaction` to a selected proxy target using an operator-supplied upstream transaction id, show a predicted next upstream id from the latest stored mapping, then record the recovered mapping for auditability.
- Session lifecycle hardening increment 1: duplicate `StartTransaction` retries reuse the existing active local transaction, duplicate `StopTransaction` calls preserve original stop data, and unmatched positive transaction stops are logged without creating or mutating sessions.
- Multi-upstream policy increment 1: each charger can have at most three enabled proxy targets, disabled targets remain configurable, runtime forwarding uses deterministic oldest-first target order, and the proxy target UI shows and enforces the enabled-target cap.

## Next Candidate Slices

### UI density pass

Run a focused density and consistency pass across the operator UI so the major charger, session, tag, proxy, and communication views stay information-dense without becoming harder to scan.

Scope:

- Review page headers, toolbars, tables, cards, and inline actions for spacing, alignment, icon usage, and repeated interaction patterns.
- Normalize compact action treatment across list pages and dashboards, including better handling of long charger and proxy target labels.
- Improve responsive behavior for dense layouts on smaller laptop widths before introducing new major UI surfaces.
- Keep the slice visual and interaction-focused; do not expand product scope or rewrite page architecture.

Acceptance criteria:

- Charger, sessions, tags, proxy targets, and communication journal pages use a consistent density model and action pattern.
- Important table actions remain discoverable with accessible labels/tooltips after compaction.
- Common laptop and tablet layouts avoid unnecessary wrapping, clipping, or horizontal overflow in the main operator flows.
- Frontend coverage is updated for any shared component or interaction changes introduced by the density pass.

### Settings display preferences

Add a narrow set of non-secret operator display preferences so the UI can better fit different operating styles without reintroducing local-only state drift.

Scope:

- Define the first supported display preferences, such as theme behavior, timestamp presentation, and compact-versus-comfortable data density where appropriate.
- Persist those preferences through the settings backend instead of ad hoc browser-only state.
- Apply preferences consistently across dashboard, sessions, communication, and settings screens.
- Keep the slice limited to presentation concerns and do not mix it with authorization or proxy behavior settings.

Acceptance criteria:

- Operators can review and change the supported display preferences from the Settings page.
- Preferences survive refresh and backend restart.
- Timestamp and density-related preferences apply consistently across the major operator views they affect.
- Frontend and backend tests cover preference read/write flows and rendering changes for each supported option.

### Communication export and purge

Extend the communication journal with operator-safe export and manual purge capabilities, while preserving the existing redaction boundaries.

Scope:

- Add filtered export for communication journal records in an operator-usable format, with the export honoring existing redaction rules.
- Add manual purge controls with explicit scope selection and destructive confirmation, separate from automatic retention.
- Show enough retention and purge context in the UI for operators to understand what will be removed or exported.
- Keep journal export and purge limited to protected admin flows; do not expose raw payload archives to the public frontend.

Acceptance criteria:

- Operators can export the currently scoped communication journal data without revealing redacted secrets.
- Operators can manually purge selected journal history only after an explicit confirmation step.
- Automatic retention and manual purge behavior remain distinct and understandable in the UI.
- Tests cover export filtering, payload redaction, purge confirmation, and retention interactions.

### Operational health overview

Build a higher-level operational health surface that summarizes charger, session, proxy, and communication issues without requiring operators to hop across multiple detailed pages first.

Scope:

- Combine charger connectivity, stale-session warnings, proxy runtime health, recent communication failures, and onboarding/setup gaps into one overview.
- Surface the most important degraded states first, with drill-down links into the charger dashboard, sessions, communication journal, and settings.
- Reuse existing live-update infrastructure so health changes appear quickly without aggressive polling.
- Keep the overview installation-focused first; do not attempt full analytics or historical reporting in this slice.

Acceptance criteria:

- Operators can identify disconnected chargers, degraded upstream proxy targets, and likely session issues from one protected view.
- Each surfaced health item links to the page where the operator can inspect or resolve it.
- Live updates refresh the overview when charger, session, or proxy state changes.
- Frontend and backend tests cover the summary API/view model and at least one degraded-state update path per health category.

### Meter gap polish

Polish the operator experience around sessions with incomplete or delayed meter data so energy context remains usable during review and recovery workflows.

Scope:

- Clarify when a session total is exact, inferred from the latest known meter sample, or falling back to the start meter because no later sample exists.
- Surface that recovery context consistently in session detail, stale-session review, and force-close previews.
- Handle common SmartEVSE/OCPP recovery cases where stop-time meter data arrives late or not at all.
- Keep inferred values visibly identified so operators do not confuse recovered estimates with exact charger-reported totals.

Acceptance criteria:

- Sessions with missing stop-time meter data clearly show the fallback source used for operator-visible totals.
- Force-close and stale-session review flows explain whether totals are exact or inferred before the operator confirms an action.
- Tests cover sessions with full meter data, latest-sample fallback, and start-meter-only fallback.
- Documentation or in-product copy makes the recovery behavior understandable without exposing internal implementation details.

### Session lifecycle hardening

Harden the backend session state machine against duplicate, late, partial, or restart-recovery flows that still appear in real charger integrations.

Scope:

- Review and tighten handling for duplicate `StartTransaction`/`StopTransaction`, late status transitions, remote-stop races, and backend restart recovery.
- Reduce the chance of split, orphaned, or silently stale sessions when charger traffic is noisy or incomplete.
- Improve operator-visible lifecycle warnings so unusual session sequences are explainable without scanning raw protocol traces first.
- Keep local authorization and local persistence as the primary source of truth even when upstream proxies misbehave.

Acceptance criteria:

- Duplicate or late lifecycle events do not create duplicate active sessions or corrupt stored session totals.
- Backend restart recovery preserves or reconciles active session state predictably.
- Operator-visible session warnings distinguish transport noise from cases that need manual review.
- Backend tests cover duplicate starts, duplicate stops, missing stops, remote-stop timing races, and restart recovery flows.

### Proxy resilience polish

Polish the persistent proxy runtime so upstream instability is easier to reason about and less disruptive to the local-primary charging flow.

Scope:

- Improve reconnect/backoff visibility, last-failure reporting, and retry timing for persistent upstream websocket connections.
- Tighten failure handling around charger disconnect/reconnect, target disable/enable transitions, and message routing during upstream churn.
- Make it easier to tell whether a deny-capable upstream is disconnected, retrying, intentionally disabled, or blocked by configuration.
- Preserve fail-open/fail-closed behavior and avoid any regression where upstream issues unnecessarily break local charger connectivity.

Acceptance criteria:

- Operators can see current proxy target state, retry timing, and latest failure context without reading backend logs.
- Repeated upstream disconnects do not leak runtime resources or leave orphaned reconnect loops behind.
- Charger reconnects and target configuration changes rebind proxy behavior predictably.
- Backend tests cover reconnect timing, disable/enable transitions, and deny-capable outage policy behavior under failure.

### Diagnostics view

Add a dedicated charger diagnostics view that brings together the most useful charger and protocol state for troubleshooting without forcing operators into raw journal analysis first.

Scope:

- Show per-charger connection status, recent heartbeat/traffic timing, firmware status, current transaction context, proxy target state, and recent warnings in one place.
- Provide a compact timeline or event list that helps operators correlate charger state changes with proxy/runtime issues.
- Link out to the communication journal for deep protocol inspection instead of duplicating the full raw trace UI.
- Keep sensitive payloads redacted and avoid exposing backend-only secrets in diagnostic summaries.

Acceptance criteria:

- Each charger has a protected diagnostics surface with enough context to answer "is it connected, talking, charging, and forwarding?" quickly.
- Recent warning and state transitions can be correlated without opening multiple other pages first.
- Diagnostics data updates live or on lightweight refresh in the same way as related existing views.
- Frontend and backend tests cover the diagnostics data model and at least one charger issue scenario end to end.

### Frontend and backend test expansion

Expand automated coverage around the slices that now carry the most product risk: onboarding/settings, session recovery, proxy routing/resilience, diagnostics, and communication controls.

Scope:

- Add backend integration coverage for lifecycle edge cases, settings persistence, proxy health transitions, journal export/purge, and simulator-assisted flows.
- Add frontend coverage for onboarding, settings, dense table actions, diagnostics, health overview, and communication controls.
- Prefer focused high-signal tests over large brittle end-to-end suites, while keeping one or two cross-layer smoke paths for critical operator workflows.
- Tighten test fixtures so secrets and raw sensitive payloads are not copied into snapshots or golden outputs.

Acceptance criteria:

- The repo has explicit automated coverage for each newly added candidate slice before those slices are considered complete.
- Critical session/proxy/settings regressions can be reproduced by automated tests without requiring manual charger access.
- Test helpers and fixtures keep redaction boundaries intact.
- Development documentation points contributors to the relevant frontend and backend test commands.

### Multi-upstream policy

Define and enforce the product policy for multiple simultaneous upstream proxy targets so authorization, mirroring, and failure behavior stay deterministic as the product grows.

Scope:

- Define the supported cap and policy for multiple proxy targets per charger, including whether the installation can use up to three active upstreams and how those targets are prioritized.
- Decide which upstreams may influence local authorization decisions, how conflicting responses resolve, and how timeouts affect the final outcome.
- Make the policy visible in admin UI copy and backend validation instead of leaving it implicit in runtime behavior.
- Preserve the local-primary model: local tag authorization remains authoritative unless an explicitly configured external-deny policy says otherwise.

Acceptance criteria:

- Operators cannot configure proxy target combinations that violate the defined multi-upstream policy.
- Authorization and transaction-mirroring outcomes remain deterministic when multiple upstreams are assigned to one charger.
- The source of a deny decision or mirrored-routing decision is visible in operator diagnostics/logging.
- Backend tests cover priority, conflict, timeout, and cap-enforcement behavior for multi-upstream setups.

### Backup, restore, and admin maintenance

Add protected maintenance workflows for preserving and repairing a running installation without dropping to ad hoc filesystem or database handling.

Scope:

- Define what belongs in a backup artifact, what stays out, and how sensitive settings or credentials are handled during export and restore.
- Add admin-only backup creation and restore workflows with explicit confirmation, compatibility checks, and operator warnings about service impact.
- Add a narrow set of related maintenance actions such as retention cleanup review, database maintenance hooks, or safe restart guidance where it improves supportability.
- Keep maintenance actions operationally safe and auditable; destructive actions must be deliberate and clearly explained.

Acceptance criteria:

- Operators can create a protected backup artifact with a documented contents policy.
- Restore requires explicit confirmation and validates compatibility before applying changes.
- Maintenance actions do not silently expose secrets in downloaded artifacts, logs, or frontend responses.
- Documentation explains backup cadence, restore caveats, and any service interruption expectations.
