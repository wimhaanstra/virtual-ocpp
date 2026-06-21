# Charger context switcher design

## Problem

The global chrome currently contains a charger selector with an `All chargers` option. In practice, charger context only matters on charger-scoped pages, and the global selector makes the navigation feel heavier on desktop and mobile.

## Goals

- Remove charger selection from the main navigation/top chrome.
- Show charger context only on charger-scoped pages.
- Switch chargers through a modal picker.
- Keep the existing `?chargerId=` URL behavior so refresh and back navigation continue to work.
- Avoid an `All chargers` option on scoped pages.

## Non-goals

- No route model rewrite to `/chargers/:id/...`.
- No backend data model changes.
- No changes to global dashboard behavior beyond removing the chrome-level selector.

## Approved approach

Add a reusable charger context strip for charger-scoped pages. The strip shows the selected charger label/id and a `Switch` button. The button opens a modal listing registered chargers. Choosing a charger updates the existing selected charger state and URL query parameter.

If no charger is selected, scoped pages show the strip with an empty state and a `Select charger` action. Global pages do not show the strip.

## Acceptance criteria

- The main sidebar/top chrome no longer contains a charger selector.
- Charger dashboard, sessions, proxy targets, and tag access pages expose charger switching through a modal.
- The modal lists registered chargers and marks the current charger.
- Selecting a charger updates scoped data through the existing selected charger flow.
- Existing tests, type checks, and production build pass.
