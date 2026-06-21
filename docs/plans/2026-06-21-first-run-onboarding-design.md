# First-run Operator Onboarding Design

## Problem

A fresh Virtual OCPP install currently exposes the admin interface, but setup knowledge is spread across the charger wizard, Tags page, Tag access page, proxy targets, and documentation. A first-time operator needs one guided path that explains how the system works, connects a charger, and prepares a tag that can authorize charging.

## Goals

- Automatically guide a first-time authenticated admin through the minimum useful setup.
- Explain the operating model without turning the app into a marketing or documentation page.
- Reuse the existing charger detection flow instead of adding a separate charger registration mechanism.
- Allow the operator to create or choose a tag and grant it to the newly detected charger.
- Finish on the charger dashboard so the operator can continue with proxy targets and testing.

## Non-goals

- Do not configure proxy targets inside this first slice. Proxy setup has more fields, credentials, station-id behavior, and tag mappings, so it should stay in the existing Proxy targets workflow.
- Do not require onboarding before the app can be used. Operators must be able to skip it.
- Do not change OCPP authorization semantics. Tags remain global and charger access remains explicit.

## Current Context

- `ChargerOnboardingModal` already shows the OCPP URL template, protocol/auth metadata, waits for a new charger registry row, allows a label, and switches context.
- Tags are globally managed through `/api/tags`.
- Per-charger tag grants use `PUT /api/tags/:id/chargers/:chargerId`.
- The app already persists local UI preferences in `localStorage`, but a first-run marker should be considered operator/admin state rather than only browser state if we want it to work across devices.

## Recommended Approach

Add a new first-run onboarding modal that orchestrates existing setup actions:

1. Intro step: explain the local-primary model in concise operator language.
2. Charger step: embed or reuse the existing charger wizard content and detection behavior.
3. Tag step: let the operator select an existing tag or create a new enabled tag.
4. Grant step: grant the selected tag to the detected charger.
5. Finish step: mark onboarding complete and route to `/charger-dashboard?chargerId=<detected>`.

Completion state should be persisted by the backend so it applies to the admin installation, not just the browser. A localStorage fallback can be used only as a temporary UI guard if the settings endpoint is unavailable.

## Alternatives Considered

### Extend the existing charger wizard only

This is smaller but makes the normal “add charger” flow too broad. Reusing parts of the charger wizard inside a first-run flow keeps later charger additions fast.

### Put onboarding only in documentation

This avoids product work but does not help an operator during first setup. It also misses the chance to automatically grant the first tag to the first charger.

### Include proxy target setup in onboarding

This could create a full setup path, but proxy targets are credential-heavy and vary by upstream platform. Keeping proxy setup as the next action after onboarding keeps this slice bounded.

## Data and API Design

Add a small admin setting for onboarding state, for example:

- `GET /api/settings/onboarding`
- `PATCH /api/settings/onboarding`

Stored fields:

- `completed`: boolean
- `completedAt`: ISO timestamp or null
- `skippedAt`: ISO timestamp or null

The frontend should open onboarding after login when neither `completedAt` nor `skippedAt` is set. A manual relaunch action should ignore the completed marker.

## UI Design

The onboarding flow should be a wide modal with compact numbered steps. It should follow the current Charge Amber restrained styling and avoid nested card-heavy layouts.

Expected states:

- Loading onboarding status
- Intro/explanation
- Waiting for charger
- Charger detected
- Tag selection or tag creation
- Granting access
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
- Completion routes to the charger dashboard for the detected charger.
- Documentation explains the first-run flow and how to rerun it.
