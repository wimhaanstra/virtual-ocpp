# OCPP Version Compatibility Research

## Summary

Virtual OCPP should keep Smart EVSE-facing support centered on OCPP 1.6j and treat newer OCPP support as an upstream adapter layer, not as a transparent pass-through conversion.

The Open Charge Alliance describes OCPP as the communication protocol between charging stations and charging management systems. OCA lists OCPP 1.6, OCPP 2.0.1, and OCPP 2.1 as currently available protocol versions. OCA also states that OCPP 2.0.1 adds device management, improved transaction handling, additional security, smart charging, ISO 15118 support, display/messaging, and other improvements compared with OCPP 1.6, and that OCPP 1.6 and OCPP 2.0.1 are not compatible.

Source: https://openchargealliance.org/protocols/open-charge-point-protocol/

## Recommendation

Build any newer-version support as explicit upstream protocol adapters:

- Charger side remains OCPP 1.6j for Smart EVSE.
- Virtual OCPP keeps its current local-primary domain model: chargers, tags, sessions, meter samples, communication journal, and proxy targets.
- Each proxy target declares the upstream OCPP version it expects.
- The first adapter target should be OCPP 2.0.1, because it is the stable 2.x baseline and OCPP 2.1 builds on 2.0.1 compatibility.
- The adapter should expose capability flags and unsupported-case behavior in the UI, rather than pretending all OCPP 1.6 traffic can be converted losslessly.

## Why Not Transparent Conversion

OCPP 1.6j and OCPP 2.0.1 differ in transaction handling, device management, authorization/security concepts, and feature scope. A transparent bridge would hide important semantic differences:

- 1.6 `StartTransaction`, `MeterValues`, and `StopTransaction` do not map one-to-one onto newer transaction event flows.
- 2.x has broader device model and monitoring behavior than Smart EVSE can provide through 1.6j.
- 2.x security and ISO 15118-related features cannot be synthesized reliably from a 1.6 charger.
- Some upstream platforms may rely on 2.x fields that Virtual OCPP cannot know without policy defaults.

## Proposed Adapter Boundary

Add an upstream adapter interface behind proxy targets:

```text
Smart EVSE charger
  -> OCPP 1.6j local server
  -> Virtual OCPP domain events
  -> proxy target adapter
  -> upstream OCPP 1.6j or future OCPP 2.0.1
```

The current OCPP 1.6j proxy target is one adapter. A future OCPP 2.0.1 adapter should translate from normalized domain events, not directly from raw OCPP 1.6 message arrays.

## Initial Mapping Scope

The first proof of concept should cover the smallest operational path:

- charger boot/availability equivalent
- heartbeat or online state
- local authorization result with tag/id token mapping policy
- transaction start
- periodic meter values
- transaction stop
- connector status changes
- communication journal visibility for translated outbound payloads

Out of scope for the first implementation:

- ISO 15118 contract/payment flows
- full 2.x device model inventory
- firmware management conversion
- advanced smart charging conversion
- bidirectional/V2X/DER behavior

## Data Model Impact

Proxy targets need at least:

- `ocppVersion`: initially `ocpp1.6`, future `ocpp2.0.1`
- adapter capability metadata in API responses
- explicit unsupported-action policy, for example `ignore`, `log-only`, or `fail-target`

Communication journal rows should keep the actual outbound translated payload, target protocol version, and any translation warning.

## Operator UX

The proxy target form should eventually show:

- upstream OCPP version
- whether the target can deny charging
- station identity used upstream
- translation limitations for that target
- latest translation warnings in diagnostics/communication views

## Risks

- Upstream OCPP 2.x platforms may require features Smart EVSE cannot provide.
- Transaction semantics can be subtly wrong if conversion is implemented as raw message rewrites.
- Certification expectations may not be met by a gateway adapter unless tested explicitly against OCA tools.
- More protocol versions increase troubleshooting complexity, so operator-visible diagnostics become more important.

## Acceptance Criteria For A Future Implementation

- OCPP 1.6j charger behavior remains unchanged.
- Existing OCPP 1.6j proxy targets remain compatible.
- OCPP 2.0.1 targets are explicitly configured per proxy target.
- Unsupported mappings are visible in logs/communication journal and do not silently corrupt sessions.
- Automated adapter tests cover boot, authorization, transaction start, meter values, transaction stop, and unsupported cases.
