# Remaining Slices Execution Plan

This plan turns the remaining candidate slices in [docs/implementation-plan.md](/Volumes/Projects/sorted-bits/virtual-ocpp/docs/implementation-plan.md) into one execution order that matches the current repo shape and the documented product invariants.

## Planning Baseline

- The backend already has stable seams for settings, visibility, communication journal, live updates, charger commands, and OCPP proxy/runtime logic under `apps/server/src`.
- The frontend already has protected route-level views, a sidebar shell, live-update refresh wiring, and broad UI coverage concentrated in `apps/web/src/App.tsx`, `apps/web/src/components/*`, and `apps/web/src/App.test.tsx`.
- Current settings persistence only covers onboarding. Theme and sidebar collapse are still browser-local in `apps/web/src/app-helpers.ts` and `apps/web/src/App.tsx`.
- Current communication journal support already covers filtered listing, CSV export, and explicit/manual purge on top of retention-based cleanup.
- Current proxy target behavior is charger-scoped and persistence-backed, but the product policy for multiple simultaneous upstreams is still implicit.
- A reusable charger-command transport already exists for `GetConfiguration`, `ChangeConfiguration`, `TriggerMessage`, and `RemoteStopTransaction`, but only remote stop is surfaced through the protected admin API today.

## Shared Execution Rules

- Keep one top-level slice per mergeable commit. Do not combine multiple runtime slices into one commit.
- Any slice that changes persisted behavior must land with schema migration, backend tests, frontend changes if applicable, and doc updates in the same slice.
- When a slice changes product behavior, update `docs/implementation-plan.md` and whichever of `docs/project-definition.md`, `docs/development.md`, or `docs/deployment.md` are affected before marking it complete.
- Preserve the local-primary model: charger connectivity, local tag authorization, and local session persistence remain authoritative unless an explicitly configured external-deny policy says otherwise.
- Keep secrets out of logs, exports, snapshots, examples, and frontend responses.

## Ordered Slice Sequence

| Order | Slice | Why This Order | Depends On |
| --- | --- | --- | --- |
| 1 | Session lifecycle hardening | Stabilizes the session source of truth before any more operator-facing recovery or health work. | Current runtime only |
| 2 | Multi-upstream policy | Locks the supported upstream cap and deterministic deny/mirroring policy before deeper proxy work. | 1 |
| 3 | Proxy resilience polish | Builds on the finalized multi-upstream policy and current persistent proxy runtime. | 1, 2 |
| 4 | Meter gap polish | Safer once session and proxy lifecycle rules are stable. | 1, 3 |
| 5 | Communication export and purge | Adds missing operator controls on an already-live journal surface without blocking runtime slices. | Current journal only |
| 6 | Settings display preferences | Replaces local-only shell preferences with persisted settings before more new UI surfaces land. | Current settings only |
| 7 | OCPP diagnostics and configuration controls | Reuses the existing charger-command seam and journal before the broader diagnostics view is built on top of it. | Current charger commands, 5 |
| 8 | Operational health overview | Should summarize stable session, proxy, meter-gap, onboarding, communication, and charger-command signals. | 1, 3, 4, 5, 6 |
| 9 | Diagnostics view | Reuses the hardened runtime, health signals, and charger-command controls for charger-specific drill-down. | 1, 3, 4, 7, 8 |
| 10 | Backup, restore, and admin maintenance | Safer after settings, journal policy, and multi-upstream/runtime behavior are settled. | 2, 5, 6 |
| 11 | UI density pass | Best done after new health, diagnostics, and maintenance surfaces exist so compaction happens once. | 5, 6, 8, 9, 10 |
| 12 | Frontend and backend test expansion | Final gap-closing slice after the remaining behavior is in place. | 1-11 |

## Subagent Strategy

Use three parallel work lanes, but keep schema and state-machine ownership single-threaded inside a slice.

- `server-runtime` lane: `apps/server/src/ocpp/*`, `visibility.ts`, `communication-journal*`, `settings.ts`, `db/schema.ts`, `drizzle/*.sql`, backend tests.
- `web-operator` lane: `apps/web/src/App.tsx`, `app-helpers.ts`, `types.ts`, `components/*`, `App.test.tsx`, styles.
- `verification-docs` lane: slice acceptance review, smoke validation, and required doc updates.

Coordination rules:

- For slices 1-4 and 10, the `server-runtime` lane owns the contract first. The `web-operator` lane starts only after route shape and persistence behavior are settled.
- For slices 5-9 and 11, freeze backend response shapes early, then let `web-operator` and `verification-docs` run in parallel.
- Slice 12 is the only place where server and web coverage work should intentionally branch in parallel and reconverge on shared smoke verification.

## Slice Playbooks

### 1. Session lifecycle hardening

- Primary surfaces: `apps/server/src/ocpp/handlers.ts`, `apps/server/src/ocpp/repository.ts`, `apps/server/src/visibility.ts`, `apps/server/src/ocpp/ocpp.test.ts`, `apps/server/src/app.test.ts`
- Dependency goal: establish one predictable local session state machine before adding more recovery and health logic
- Subagent strategy: `server-runtime` only until the API and warning model settle; `verification-docs` joins for regression review
- Acceptance gate:
  - Duplicate or late `StartTransaction` and `StopTransaction` flows do not create duplicate active sessions or corrupt totals.
  - Restart recovery preserves or reconciles active sessions predictably.
  - Operator-visible warnings distinguish transport noise from manual-review cases.
  - `docs/implementation-plan.md` is updated to mark the slice complete only after tests pass.
- Test commands:
  - `npm run test --workspace=@virtual-ocpp/server`
  - `npm run lint --workspace=@virtual-ocpp/server`
  - `npm run build --workspace=@virtual-ocpp/server`
  - `ADMIN_PASSWORD=correct-password npm run smoke:simulator`
- Commit strategy: one server-heavy commit, for example `feat(server): harden session lifecycle flows`

### 2. Multi-upstream policy

- Primary surfaces: `apps/server/src/proxy-targets.ts`, `apps/server/src/ocpp/proxy-service.ts`, `apps/server/src/visibility.ts`, `apps/server/src/db/schema.ts`, `apps/server/src/app.test.ts`, `apps/server/src/ocpp/ocpp.test.ts`, `apps/web/src/App.tsx`, and proxy-target-related components under `apps/web/src/components/`
- Dependency goal: define and enforce the supported cap and deterministic routing policy before more proxy observability work
- Subagent strategy: `server-runtime` sets policy, validation, and diagnostics payloads first; `web-operator` follows with explicit UI copy and validation states
- Acceptance gate:
  - One charger can use at most the documented supported number of upstreams, with the policy explicitly surfaced as up to three configured targets.
  - Deny-capable versus monitor-only influence is deterministic and visible in operator-facing data.
  - Conflicts, priority, timeout, and cap-enforcement behavior are covered in backend tests.
  - Docs explain the policy instead of leaving behavior implicit.
- Test commands:
  - `npm run test --workspace=@virtual-ocpp/server`
  - `npm run test --workspace=@virtual-ocpp/web`
  - `npm run lint --workspace=@virtual-ocpp/server`
  - `npm run lint --workspace=@virtual-ocpp/web`
  - `npm run build --workspace=@virtual-ocpp/server`
  - `npm run build --workspace=@virtual-ocpp/web`
- Commit strategy: one cross-layer commit, for example `feat(proxy): enforce multi-upstream policy`

### 3. Proxy resilience polish

- Primary surfaces: `apps/server/src/ocpp/proxy-service.ts`, `apps/server/src/live-updates.ts`, `apps/server/src/visibility.ts`, `apps/server/src/log-writer.ts`, dashboard/session frontend consumers, backend proxy tests
- Dependency goal: make upstream connection state, retry timing, and disable or reconnect transitions trustworthy before they feed health and diagnostics
- Subagent strategy: `server-runtime` owns runtime state and event model; `web-operator` adds current-state visibility only after API fields settle
- Acceptance gate:
  - Reconnect state, retry timing, and last failure context are visible without backend-log scraping.
  - Charger reconnect and target enable or disable transitions do not leave orphaned reconnect loops or stale runtime state.
  - Deny-capable outage policy behavior remains unchanged except for clearer observability.
  - Live updates refresh the affected views when proxy health changes.
- Test commands:
  - `npm run test --workspace=@virtual-ocpp/server`
  - `npm run test --workspace=@virtual-ocpp/web`
  - `npm run lint --workspace=@virtual-ocpp/server`
  - `npm run build --workspace=@virtual-ocpp/server`
  - `ADMIN_PASSWORD=correct-password npm run smoke:simulator`
- Commit strategy: one commit, for example `feat(proxy): polish persistent upstream resilience`

### 4. Meter gap polish

- Primary surfaces: `apps/server/src/visibility.ts`, `apps/server/src/charging-stats.ts`, meter-gap persistence/tests, `apps/web/src/components/SessionsView.tsx`, `apps/web/src/components/ForceClosePreviewModal.tsx`, `apps/web/src/components/DashboardView.tsx`
- Dependency goal: align fallback semantics with the hardened session model before more health and diagnostics UI builds on the same totals
- Subagent strategy: `server-runtime` defines exact versus inferred source flags first; `web-operator` applies that model consistently across session review flows
- Acceptance gate:
  - Session totals clearly identify exact, latest-sample fallback, or start-meter-only fallback.
  - Force-close and stale-session review show the same fallback source before confirmation.
  - Tests cover exact totals, latest-sample fallback, and no-later-sample fallback.
  - User-facing copy stays operational and avoids leaking internal implementation terms.
- Test commands:
  - `npm run test --workspace=@virtual-ocpp/server`
  - `npm run test --workspace=@virtual-ocpp/web`
  - `npm run lint --workspace=@virtual-ocpp/server`
  - `npm run lint --workspace=@virtual-ocpp/web`
  - `npm run build --workspace=@virtual-ocpp/web`
- Commit strategy: one commit, for example `feat(sessions): clarify meter gap recovery totals`

### 5. Communication export and purge

- Primary surfaces: `apps/server/src/communication-journal.ts`, `apps/server/src/communication-journal-routes.ts`, `apps/server/src/communication-journal.test.ts`, `apps/web/src/components/CommunicationView.tsx`, `apps/web/src/App.test.tsx`
- Dependency goal: add explicit admin controls to the journal before health and diagnostics start linking to it more heavily
- Subagent strategy: backend defines export and scoped purge contract; frontend implements confirmation and retention context after the contract is fixed
- Acceptance gate:
  - Export honors all current filters and preserves existing redaction boundaries.
  - Manual purge requires explicit scope selection and destructive confirmation and stays separate from automatic retention purge.
  - Exported artifacts and UI responses never expose secrets or unredacted payloads.
  - Communication docs describe export scope, purge behavior, and retention interaction.
- Test commands:
  - `npm run test --workspace=@virtual-ocpp/server`
  - `npm run test --workspace=@virtual-ocpp/web`
  - `npm run lint --workspace=@virtual-ocpp/server`
  - `npm run lint --workspace=@virtual-ocpp/web`
  - `npm run build --workspace=@virtual-ocpp/server`
  - `npm run build --workspace=@virtual-ocpp/web`
- Commit strategy: one commit, for example `feat(communication): add export and manual purge controls`

### 6. Settings display preferences

- Primary surfaces: `apps/server/src/settings.ts`, `apps/server/src/settings.test.ts`, `apps/server/src/db/schema.ts`, new migration under `apps/server/drizzle/`, `apps/web/src/app-helpers.ts`, `apps/web/src/App.tsx`, `apps/web/src/components/SettingsView.tsx`, `apps/web/src/App.test.tsx`
- Dependency goal: move theme, timestamp, and density preferences into SQLite-backed settings before new UI surfaces multiply preference edge cases
- Subagent strategy: `server-runtime` adds persisted settings model and API; `web-operator` migrates theme/sidebar-adjacent behavior off local-only storage and applies preference reads consistently
- Acceptance gate:
  - Supported display preferences are editable from Settings and survive refresh plus backend restart.
  - Timestamp and density preferences are applied consistently across dashboard, sessions, communication, and settings.
  - Any remaining browser-local preference is intentionally documented as shell-only or removed from the slice scope.
  - Migration is backward-safe for existing onboarding settings rows.
- Test commands:
  - `npm run test --workspace=@virtual-ocpp/server`
  - `npm run test --workspace=@virtual-ocpp/web`
  - `npm run lint --workspace=@virtual-ocpp/server`
  - `npm run lint --workspace=@virtual-ocpp/web`
  - `npm run build --workspace=@virtual-ocpp/server`
  - `npm run build --workspace=@virtual-ocpp/web`
- Commit strategy: one cross-layer commit, for example `feat(settings): persist operator display preferences`

### 7. OCPP diagnostics and configuration controls

- Primary surfaces: `apps/server/src/ocpp/charger-command-service.ts`, `apps/server/src/ocpp/types.ts`, `apps/server/src/visibility.ts` or an extracted charger-diagnostics route module, `apps/server/src/app.test.ts`, charger-facing frontend route/components, and communication-journal consumers
- Dependency goal: surface safe charger command and configuration controls before the broader diagnostics UI tries to incorporate them
- Subagent strategy: `server-runtime` defines the allowlisted command/config contract first; `web-operator` follows with charger-scoped UX and journal drill-down links
- Acceptance gate:
  - Operators can request allowlisted `GetConfiguration` reads from a connected charger without exposing arbitrary vendor-specific keys or secret-like values.
  - Operators can attempt allowlisted `ChangeConfiguration` writes and see `Accepted`, `Rejected`, `RebootRequired`, or `NotSupported` without backend reinterpretation.
  - Operators can issue supported `TriggerMessage` requests and understand that an accepted trigger only means the charger intends to send the follow-up message.
  - Disconnected chargers and blocked keys fail clearly and do not create synthetic OCPP command state.
- Test commands:
  - `npm run test --workspace=@virtual-ocpp/server`
  - `npm run test --workspace=@virtual-ocpp/web`
  - `npm run lint --workspace=@virtual-ocpp/server`
  - `npm run lint --workspace=@virtual-ocpp/web`
  - `npm run build --workspace=@virtual-ocpp/server`
  - `npm run build --workspace=@virtual-ocpp/web`
- Commit strategy: one cross-layer commit, for example `feat(diagnostics): add charger configuration and trigger controls`

### 8. Operational health overview

- Primary surfaces: `apps/server/src/visibility.ts`, `apps/server/src/live-updates.ts`, `apps/server/src/charging-stats.ts`, `apps/web/src/components/GlobalDashboardView.tsx`, `apps/web/src/App.tsx`, related tests
- Dependency goal: create one installation-level summary once the underlying session, proxy, meter-gap, communication, and settings signals are stable
- Subagent strategy: `server-runtime` owns the health summary/view model; `web-operator` turns it into one protected overview with drill-down links and live refresh
- Acceptance gate:
  - One protected overview surfaces disconnected chargers, degraded proxy targets, stale-session warnings, communication trouble signals, and onboarding/setup gaps.
  - Each health item links directly to the existing resolution page.
  - Live updates refresh health without introducing aggressive polling.
  - The view honors the persisted display preferences from slice 6.
- Test commands:
  - `npm run test --workspace=@virtual-ocpp/server`
  - `npm run test --workspace=@virtual-ocpp/web`
  - `npm run lint --workspace=@virtual-ocpp/server`
  - `npm run lint --workspace=@virtual-ocpp/web`
  - `npm run build --workspace=@virtual-ocpp/web`
- Commit strategy: one commit, for example `feat(web): add operational health overview`

### 9. Diagnostics view

- Primary surfaces: `apps/server/src/visibility.ts`, possibly a dedicated diagnostics route module if extraction is warranted, `apps/web/src/App.tsx`, new diagnostics components, `apps/web/src/App.test.tsx`
- Dependency goal: provide charger-specific troubleshooting after the higher-level health summary exists
- Subagent strategy: `server-runtime` assembles the charger diagnostics model and event timeline; `web-operator` focuses on compact drill-down UX with links back to communication
- Acceptance gate:
  - Operators can answer whether a charger is connected, talking, charging, and forwarding from one diagnostics surface.
  - The view reuses the existing diagnostics/configuration command surface instead of inventing a second configuration workflow.
  - Recent state changes and warnings can be correlated without opening several other pages first.
  - Diagnostics data updates live or on the same lightweight refresh model as the related existing pages.
  - Sensitive payloads stay redacted and diagnostics link to Communication for rawer context instead of duplicating it.
- Test commands:
  - `npm run test --workspace=@virtual-ocpp/server`
  - `npm run test --workspace=@virtual-ocpp/web`
  - `npm run lint --workspace=@virtual-ocpp/server`
  - `npm run lint --workspace=@virtual-ocpp/web`
  - `npm run build --workspace=@virtual-ocpp/web`
- Commit strategy: one commit, for example `feat(diagnostics): add charger troubleshooting view`

### 10. Backup, restore, and admin maintenance

- Primary surfaces: new maintenance routes under `apps/server/src`, `apps/server/src/settings.ts` or a dedicated maintenance module, SQLite-facing helpers, `docs/deployment.md`, settings/admin frontend, and matching tests
- Dependency goal: define safe operational maintenance only after the main persisted data model and operator controls are settled
- Subagent strategy: `server-runtime` owns artifact format, compatibility checks, and destructive safeguards; `web-operator` adds narrow admin flows only after the contract and warnings are settled
- Acceptance gate:
  - Backup artifact contents are explicitly defined, exclude secrets where required, and are documented.
  - Restore requires explicit confirmation and compatibility validation before data mutation.
  - Maintenance actions are auditable and do not expose credentials or sensitive payloads in artifacts, logs, or client responses.
  - Deployment docs explain restore caveats, service impact, and safe operator expectations.
- Test commands:
  - `npm run test --workspace=@virtual-ocpp/server`
  - `npm run test --workspace=@virtual-ocpp/web`
  - `npm run lint --workspace=@virtual-ocpp/server`
  - `npm run lint --workspace=@virtual-ocpp/web`
  - `npm run build`
- Commit strategy: one commit, for example `feat(maintenance): add backup and restore workflows`

### 11. UI density pass

- Primary surfaces: `apps/web/src/components/*`, `apps/web/src/App.tsx`, `apps/web/src/styles.css`, `apps/web/src/App.test.tsx`
- Dependency goal: normalize the final set of operator surfaces once the remaining pages and settings-driven density options exist
- Subagent strategy: `web-operator` leads; `verification-docs` validates responsive behavior, accessibility labels, and consistency against the existing visual direction docs
- Acceptance gate:
  - Charger, sessions, tags, proxy targets, communication, health, diagnostics, and maintenance views use one consistent density and action pattern.
  - Compact actions keep accessible labels or tooltips.
  - Common laptop widths avoid unnecessary wrapping, clipping, and horizontal overflow on the main operator paths.
  - Density preference support from slice 6 remains intact after compaction.
- Test commands:
  - `npm run test --workspace=@virtual-ocpp/web`
  - `npm run lint --workspace=@virtual-ocpp/web`
  - `npm run build --workspace=@virtual-ocpp/web`
- Commit strategy: one frontend-only commit, for example `refactor(web): complete operator UI density pass`

### 12. Frontend and backend test expansion

- Primary surfaces: server Vitest suites, web Vitest suites, simulator smoke coverage, and `docs/development.md`
- Dependency goal: close the explicit remaining coverage gaps after the feature set is complete
- Subagent strategy: split work in parallel between `server-runtime` and `web-operator`; `verification-docs` owns the final matrix and command docs
- Acceptance gate:
  - Every slice above has explicit automated coverage in the repo before this slice is marked complete.
  - Critical settings, session, proxy, diagnostics, communication, and maintenance regressions are reproducible without manual charger access.
  - Test fixtures, snapshots, and helpers preserve redaction boundaries.
  - `docs/development.md` points contributors to the relevant server, web, and smoke verification commands.
- Test commands:
  - `npm test`
  - `npm run build`
  - `npm run lint`
  - `ADMIN_PASSWORD=correct-password npm run smoke:simulator`
- Commit strategy: one final coverage-focused commit, for example `test: expand high-risk operator and runtime coverage`

## Commit Sequencing

- Keep the sequence linear at the top level: slices 1 through 12 should produce 12 reviewable commits or 12 reviewable PR-equivalent changesets.
- Inside an active slice, temporary checkpoint commits are acceptable, but collapse them before handoff so the retained history still maps one commit to one slice.
- Migrations must never be committed ahead of the code and tests that use them.
- If a slice changes operator-visible behavior, the same commit must include the relevant doc updates and test coverage.

## Final Exit Gate

Do not consider the remaining-slices plan complete until:

- all 11 slices are marked complete in `docs/implementation-plan.md`
- `docs/project-definition.md`, `docs/development.md`, and `docs/deployment.md` match the implemented behavior
- `npm test`, `npm run build`, and `npm run lint` pass from the repo root
- the simulator smoke flow still proves a full local-primary charger session against the live OCPP endpoint
