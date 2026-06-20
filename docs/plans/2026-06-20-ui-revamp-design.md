# UI Revamp Design

## Problem

The admin UI has grown feature by feature and now feels heavier than the product needs:

- Too many panels nested inside panels.
- Large text buttons consume table space where icon-only actions would work better.
- The app only has a dark theme.
- The Activity page overlaps with Communication and has weak information hierarchy.
- The dashboard shows too much low-value snapshot data.
- Modal forms are visually messy, especially proxy target forms with mixed descriptions, credentials, behavior, and tag mapping controls.
- The current visual style feels generic and too close to default component-library styling.

## Goals

- Adopt a distinct product style using restrained Charge Amber as the primary color.
- Add light and dark modes.
- Flatten the page structure and reduce nested card/panel treatment.
- Remove the Activity page and merge useful activity rows into Communication.
- Make Communication the primary troubleshooting surface for protocol and operational events.
- Make dashboard content smaller, more operational, and less verbose.
- Convert table row actions to icon-only buttons with accessible labels/tooltips.
- Clean up modal forms with sections, aligned inputs, and less explanatory clutter.
- Keep the implementation compatible with the existing backend APIs. If a merged Communication response endpoint is added, it must be additive and must not remove the existing `logs` or `communication-journal` endpoints.

## Non-Goals

- Do not redesign authentication flows beyond matching the new visual system.
- Do not add role-based access control.
- Do not add live websocket UI updates in this slice.
- Do not add full visual regression infrastructure beyond the existing Playwright preview assets.
- Do not change OCPP behavior, proxy behavior, authorization behavior, or session semantics.

## Current Context

- The frontend is currently concentrated in `apps/web/src/App.tsx` with shared styling in `apps/web/src/styles.css`.
- Routing already supports distinct frontend URLs for pages.
- The protected pages are Home, Proxy targets, Tags, Sessions, Activity, and Communication.
- `GET /api/logs` exposes safe operational event rows.
- `GET /api/communication-journal` exposes redacted protocol traces.
- UI direction previews live in `docs/ui-examples/`.

Relevant approved previews:

- `docs/ui-examples/brand-directions.png`
- `docs/ui-examples/amber-intensity.png`
- `docs/ui-examples/layout-structure.png`
- `docs/ui-examples/detail-tuning.png`

## Approved Visual Direction

Use restrained Charge Amber:

- Primary: `#FF9D00`
- Dark shell background: near-black neutral, not blue-heavy.
- Light shell background: cool neutral gray, not beige.
- Surfaces: flat neutral panels with small radii.
- Borders: visible but quiet, used for structure instead of heavy shadows.
- Shadows: minimal or absent; use only subtle 1-2px separation when needed.
- Detail treatment: Dense Console.
- Radius: `2px` for buttons, inputs, tables, and panels.
- Table density: compact by default, with expanded details on demand.
- Surface contrast: higher contrast, especially in dark mode.
- Typography: quieter UI weights than the earlier heavy mockups while keeping table summaries legible.
- Spacing: tight, optimized for communication traces and repeated operations.

Use Charge Amber for:

- Active navigation indicator.
- Selected filter/tab state.
- Focus accents.
- Thin section accents.
- Primary action emphasis.

Do not use Charge Amber for warning state. Warning remains a separate yellow tone with explicit labels.

Recommended state colors:

- Success: green.
- Warning: yellow.
- Error: red.
- Info/protocol: blue.

## Navigation

Use a single compact sidebar.

Expanded sidebar:

- Shows product name.
- Shows navigation labels and icons.
- Shows current page indicator with restrained amber.
- Includes a collapse control.

Collapsed sidebar:

- Shows icons only.
- Keeps a visible current page indicator.
- Icons must have accessible labels/tooltips.
- The app stores collapsed/expanded preference in `localStorage`.

Remove Activity from navigation.

Final primary pages:

- Dashboard
- Communication
- Sessions
- Proxy targets
- Tags

## Dashboard

The dashboard becomes a compact operational overview, not a registry dump.

Keep:

- Selected charger identity and connection URL.
- Charger connection status.
- Proxy health summary and per-proxy connected/retrying/offline status.
- Live charging summary as a dedicated dashboard item when active sessions exist.
- Quick access to important pages through compact icon/link actions.

Remove or de-emphasize:

- Enabled tag count.
- Recent registry rows.
- Large operation snapshot sections.
- Repeated explanatory text.

Live charging appears as its own clear block, with energy, power, current, voltage, elapsed time, and last sample when available. Empty state is compact.

## Communication

Replace the separate Activity page with a merged Communication page.

Communication shows one merged timeline/table containing:

- Protocol rows from `communication_journal`.
- Operational event rows from `logs`.

Rows must include a type indicator:

- `Protocol`
- `Event`

Columns:

- Time
- Type
- Summary
- Source/target or context
- Method/status when applicable
- Expand action

Filters:

- `All`
- `Protocol`
- `Events`
- Method
- Source/target
- Charger context
- Proxy target
- Time range

Default layout:

- Compact filter toolbar above the table.
- Advanced filters can be collapsed behind a filter button or popover/drawer.
- Expandable rows show protocol payloads or event context.

The existing communication retention and purge controls remain available, but they are compact and do not dominate the page.

## Sessions

Keep the existing session behavior, but tighten the table.

- Use icon-only row actions for remote stop and local stale close.
- Use clear tooltips/accessible labels.
- Preserve the distinction between remote stop and local close.
- Keep active session status easy to scan.

## Proxy Targets

Keep proxy targets scoped to the selected charger.

Table cleanup:

- Icon-only edit/toggle/delete row actions.
- Compact status chips for enabled, mode, outage policy, credentials, and mapping count.
- Avoid long text buttons in rows.

Modal form sections:

- Identity: name, station id, enabled.
- Upstream connection: URL.
- Credentials: username, password, clear stored credentials controls.
- Authorization behavior: mode and outage policy.
- Tag mapping: local tag to outbound tag mapping rows.

Proxy tag mappings remain in the same modal and are visually separated as their own section.

## Tags

Tags remain global with selected-charger access controls.

Table cleanup:

- Icon-only edit/delete/toggle actions.
- Compact access state for the selected charger.
- Preserve the ability to add or edit tags through a modal.

Tag modal sections:

- Identity: UUID and label.
- State: enabled/disabled.
- Charger access remains table-driven outside the modal.

## Forms And Modals

Modal layout rules:

- Use one clean modal shell, not a card inside a card.
- Use section headings for related fields.
- Align fields in a predictable grid.
- Keep descriptions short and attached to the relevant section.
- Avoid subtitles between every input.
- Place cancel/save actions in a consistent footer.
- Close icon is icon-only with accessible label.
- Proxy tag mappings stay in the proxy target modal as a dedicated section, not a separate tab.

## Theme

Add light and dark mode.

Requirements:

- Theme toggle is visible in the protected shell.
- The selected theme persists in `localStorage`.
- Respect system preference for first visit if no local preference exists.
- Both themes must use the same information density and layout.
- Both themes must pass basic readability checks for body text, table text, status chips, and buttons.

## Implementation Notes

The implementation may remain in `App.tsx` for the first pass if splitting components would slow the slice down, but extraction is encouraged where it reduces risk:

- Shell/sidebar component.
- Page header/toolbar component.
- Icon action button component.
- Modal section component.
- Communication timeline row component.

Prefer CSS custom properties for theme tokens:

- backgrounds
- surfaces
- text
- muted text
- borders
- primary
- status colors
- focus rings

Avoid introducing a new UI framework.

## Risks And Mitigations

- Risk: Amber conflicts with warning state.
  - Mitigation: keep warning yellow distinct and labeled; use amber only for product/selection/focus.

- Risk: Merging logs and protocol rows makes Communication noisy.
  - Mitigation: default filters, type tabs, compact summaries, expandable details.

- Risk: Sidebar collapse hurts discoverability.
  - Mitigation: default expanded on first visit; collapsed icons have labels/tooltips and current page indicator.

- Risk: Large one-file frontend changes are hard to review.
  - Mitigation: implement in small slices and commit after each slice.

## Test Strategy

- Update frontend tests for removed Activity navigation.
- Add tests for theme toggle persistence behavior.
- Add tests for merged Communication rendering.
- Keep existing server tests unchanged unless an additive merged Communication endpoint is introduced.
- Run:
  - `npm run test --workspace=apps/web -- --run`
  - `npm run build --workspace=apps/web`
  - `npm run lint`

Use Playwright preview renderers as design artifacts, not required CI gates.

## Acceptance Criteria

- The app has working dark and light themes using restrained Charge Amber.
- Sidebar can expand and collapse; collapsed mode shows icons only and the active page indicator.
- Activity is removed from navigation.
- Useful operational event information is available on Communication.
- Communication has a merged timeline/table with protocol and event rows distinguishable by type.
- Dashboard is reduced to selected charger connection info, proxy health, live charging, and compact operational shortcuts.
- Row actions in tables are icon-only, except for primary modal submit/cancel actions.
- Proxy and tag modals are sectioned and visually aligned.
- The UI has fewer nested panels and smaller radii than the current implementation.
- Existing admin auth, charger context, proxy target, tag, session, and communication behavior still works.
