# Virtual OCPP

Virtual OCPP is a local-primary OCPP 1.6j service for Smart EVSE-style chargers with optional mirroring to external OCPP backends.

## Current behavior

- Chargers connect on `/ocpp/:chargerId`.
- Tags are global records, but each charger must be granted explicit tag access before a tag can authorize charging.
- Proxy targets are charger-scoped and can run in `monitor-only` or `deny-capable` mode with `fail-open` or `fail-closed` outage handling.
- The Settings page stores onboarding state in SQLite. When onboarding is incomplete, the first admin login opens the setup flow automatically.
- First-run onboarding can create or select a tag, grant it to the detected charger, optionally create one initial proxy target, and then mark onboarding completed.
- The charger context is selected in the UI and carried in `?chargerId=...`.
- The charger dashboard shows connection status, live charging state, proxy health, session summary, meter-gap review, active-session audit context, force-close previews, firmware status, and links into the communication journal.
- Live updates use authenticated server-sent events to invalidate the relevant REST slices.
- The repo includes a charger simulator for development, demos, and smoke tests.
- The production image serves the API, OCPP websocket endpoint, and frontend from one Fastify process with SQLite stored under `/data`.

## Operator Notes

- Use the global dashboard for fleet overview.
- Use the charger dashboard for charger-specific runtime state and troubleshooting.
- Use the Settings page to review or rerun onboarding.
- Use the Chargers, Tags, Tag access, Proxy targets, Sessions, and Communication pages for day-to-day administration.
