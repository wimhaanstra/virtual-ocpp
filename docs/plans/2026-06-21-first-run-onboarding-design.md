# First-run Operator Onboarding Design

## Problem

A fresh Virtual OCPP install currently exposes the admin interface, but setup knowledge is spread across the charger wizard, Tags page, Tag access page, proxy targets, and documentation. A first-time operator needs one guided path that explains how the system works, connects a charger, prepares a tag that can authorize charging, and optionally connects the first upstream proxy.

## Goals

- Automatically guide a first-time authenticated admin through the minimum useful setup.
- Explain the operating model without turning the app into a marketing or documentation page.
- Reuse the existing charger detection flow instead of adding a separate charger registration mechanism.
- Allow the operator to create or choose a tag and grant it to the newly detected charger.
- Allow the operator to configure an initial proxy target for the newly detected charger.
- Make the onboarding flow manually runnable from Settings so setup can be tested or repeated later.
- Finish on the charger dashboard so the operator can review live state and test charging.

## Non-goals

- Do not expose every advanced proxy-target control inside onboarding. Per-proxy tag mappings, recovery submissions, and later advanced proxy tuning should remain in the full Proxy targets workflow.
- Do not require onboarding before the app can be used. Operators must be able to skip it.
- Do not change OCPP authorization semantics. Tags remain global and charger access remains explicit.

## Current Context

- `ChargerOnboardingModal` already shows the OCPP URL template, protocol/auth metadata, waits for a new charger registry row, allows a label, and switches context.
- Tags are globally managed through `/api/tags`.
- Per-charger tag grants use `PUT /api/tags/:id/chargers/:chargerId`.
- Proxy targets are charger-scoped and created through the existing proxy target API.
- A Settings page is already planned as a global operator page for preferences and admin actions.
- The app already persists local UI preferences in `localStorage`, but a first-run marker should be considered operator/admin state rather than only browser state if we want it to work across devices.

## Recommended Approach

Add a new first-run onboarding modal that orchestrates existing setup actions:

1. Intro step: explain the local-primary model in concise operator language.
2. Charger step: embed or reuse the existing charger wizard content and detection behavior.
3. Tag step: let the operator select an existing tag or create a new enabled tag.
4. Grant step: grant the selected tag to the detected charger.
5. Proxy step: let the operator skip or create one initial proxy target for the detected charger.
6. Finish step: mark onboarding complete and route to `/charger-dashboard?chargerId=<detected>`.

Completion state should be persisted by the backend so it applies to the admin installation, not just the browser. A localStorage fallback can be used only as a temporary UI guard if the settings endpoint is unavailable.

The Settings page should expose a manual "Run onboarding" action. Manual runs should open the same onboarding flow regardless of completed/skipped state and should not erase the stored completion timestamp unless the operator completes or skips the flow again.

## Alternatives Considered

### Extend the existing charger wizard only

This is smaller but makes the normal “add charger” flow too broad. Reusing parts of the charger wizard inside a first-run flow keeps later charger additions fast.

### Put onboarding only in documentation

This avoids product work but does not help an operator during first setup. It also misses the chance to automatically grant the first tag to the first charger.

### Keep proxy target setup out of onboarding

This keeps onboarding smaller, but it leaves the operator without a working upstream path after first setup. A bounded proxy step is worth including because proxy targets are core to the product. Advanced proxy options should stay in the full Proxy targets page.

### Include all proxy target controls in onboarding

This would make onboarding complete but too dense. The guided setup should collect only the fields needed to establish the first upstream connection: name, URL, optional username/password, optional station id, enabled state, mode, and outage policy.

## Data and API Design

Add a small admin setting for onboarding state, for example:

- `GET /api/settings/onboarding`
- `PATCH /api/settings/onboarding`

Stored fields:

- `completed`: boolean
- `completedAt`: ISO timestamp or null
- `skippedAt`: ISO timestamp or null

The frontend should open onboarding after login when neither `completedAt` nor `skippedAt` is set. A manual relaunch action should ignore the completed marker.

The onboarding proxy step should use the existing proxy target create endpoint. The created target must be scoped to the detected charger id. The onboarding UI should not create a proxy target until the operator explicitly submits that step.

## UI Design

The onboarding flow should be a wide modal with compact numbered steps. It should follow the current Charge Amber restrained styling and avoid nested card-heavy layouts.

Expected states:

- Loading onboarding status
- Intro/explanation
- Waiting for charger
- Charger detected
- Tag selection or tag creation
- Granting access
- Proxy target setup or skip
- Finished
- Skipped
- Error with retry

The wizard should use concise text. Longer explanations belong in docs, not the modal.

## Testing Strategy

Frontend tests:

- Opens automatically for first-time authenticated admin.
- Does not reopen after skip or completion.
- Detects a charger using the same new-registry-row rule as the current charger wizard.
- Creates a tag and grants it to the detected charger.
- Selects an existing tag and grants it to the detected charger.
- Skips proxy target setup.
- Creates a proxy target for the detected charger.
- Can be relaunched manually from Settings after completion.
- Finishes by routing to the selected charger dashboard.

Backend tests:

- Onboarding settings endpoint is protected by admin auth.
- Completion and skip state persist.
- Invalid setting updates are rejected.

## Acceptance Criteria

- A first-time authenticated admin sees onboarding automatically.
- Operators can skip onboarding without blocking the app.
- Operators can manually relaunch onboarding later.
- The charger connection step waits for a newly registered charger.
- The tag step can create a new tag or use an existing one.
- The selected tag is granted access to the detected charger.
- The proxy step can be skipped or can create one initial charger-scoped proxy target.
- A Settings page action can manually relaunch onboarding after it has been completed or skipped.
- Completion routes to the charger dashboard for the detected charger.
- Documentation explains the first-run flow and how to rerun it.
