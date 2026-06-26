import { ArrowRight, CheckCircle2, RefreshCcw, X } from "lucide-react";
import { ChargerDiagnosticsPanel } from "./ChargerDiagnosticsPanel";
import { Button } from "./ui/button";
import type { ActiveSessionAuditResponse, MeterGapEvent } from "../types";
import { formatDateTime, formatEnergyWh } from "../app-helpers";

type DiagnosticsViewProps = {
  activeSessionAudit: ActiveSessionAuditResponse | null;
  busy: boolean;
  meterGapEvents: MeterGapEvent[];
  selectedChargerId: string;
  selectedChargerLabel: string;
  onGetConfiguration: (chargerId: string, keys: string[]) => Promise<unknown>;
  onChangeConfiguration: (chargerId: string, key: string, value: string) => Promise<unknown>;
  onTriggerMessage: (chargerId: string, requestedMessage: string, connectorId: number | null) => Promise<unknown>;
  onDismissMeterGap: (event: MeterGapEvent) => void;
  onOpenSessions: () => void;
  onScanMeterGaps: () => void;
  onSubmitMeterGap: (event: MeterGapEvent) => void;
};

export function DiagnosticsView({
  activeSessionAudit,
  busy,
  meterGapEvents,
  selectedChargerId,
  selectedChargerLabel,
  onGetConfiguration,
  onChangeConfiguration,
  onTriggerMessage,
  onDismissMeterGap,
  onOpenSessions,
  onScanMeterGaps,
  onSubmitMeterGap
}: DiagnosticsViewProps) {
  const auditItems = activeSessionAudit?.items.filter((item) => item.warnings.length > 0) ?? [];

  return (
    <section className="home-stack diagnostics-stack">
      <section className="diagnostics-hero">
        <div>
          <p className="eyebrow">Problem solving</p>
          <h2>Diagnostics</h2>
          <p className="status-copy">Run OCPP checks, review missing stop warnings, and recover possible missed meter gaps for {selectedChargerLabel}.</p>
        </div>
        <span className="pill pill-neutral mono">{selectedChargerId || "No charger selected"}</span>
      </section>

      <ChargerDiagnosticsPanel
        busy={busy}
        selectedChargerId={selectedChargerId}
        onGetConfiguration={onGetConfiguration}
        onChangeConfiguration={onChangeConfiguration}
        onTriggerMessage={onTriggerMessage}
      />

      <section className="panel table-panel">
        <div className="topbar-actions page-section-header">
          <div>
            <p className="eyebrow">Recovery</p>
            <h2>Meter gaps</h2>
            <p className="status-copy">Possible missed charging between a previous stop meter and a later session start meter.</p>
          </div>
          <Button type="button" className="button-secondary" onClick={onScanMeterGaps} disabled={busy || !selectedChargerId}>
            Scan
            <RefreshCcw aria-hidden="true" />
          </Button>
        </div>
        {meterGapEvents.length > 0 ? (
          <div className="meter-gap-list">
            {meterGapEvents.slice(0, 3).map((event) => (
              <article key={event.id}>
                <div>
                  <strong>{formatEnergyWh(event.deltaWh)} gap</strong>
                  <p className="status-copy">
                    Connector {event.connectorId} · {formatDateTime(event.previousStoppedAt)} to {formatDateTime(event.newStartedAt)}
                  </p>
                </div>
                <div className="action-row compact-action-row">
                  <span className="pill pill-warning">{event.status}</span>
                  <Button
                    type="button"
                    className="button-secondary icon-button"
                    onClick={() => onSubmitMeterGap(event)}
                    disabled={busy}
                    title="Submit recovery"
                    aria-label={`Submit meter gap ${event.id}`}
                  >
                    <CheckCircle2 aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    className="button-ghost icon-button"
                    onClick={() => onDismissMeterGap(event)}
                    disabled={busy}
                    title="Dismiss gap"
                    aria-label={`Dismiss meter gap ${event.id}`}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p>No pending meter gaps.</p>
        )}
      </section>

      <section className="panel table-panel">
        <div className="topbar-actions page-section-header">
          <div>
            <p className="eyebrow">Session audit</p>
            <h2>Missing stop checks</h2>
            <p className="status-copy">Flagged active sessions scoped to {selectedChargerLabel}.</p>
          </div>
          <Button type="button" className="button-secondary" onClick={onOpenSessions}>
            Sessions
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
        {auditItems.length === 0 ? (
          <p>No active sessions need attention.</p>
        ) : (
          <div className="session-audit-list">
            {auditItems.map((item) => (
              <article className="session-audit-item" key={item.sessionId}>
                <div className="proxy-health-item__header">
                  <div>
                    <h3>Transaction {item.transactionId}</h3>
                    <p className="status-copy">
                      Connector {item.connectorId}
                      {item.latestMeterWh !== null ? `; latest meter ${formatEnergyWh(item.latestMeterWh)}` : ""}
                      {item.latestStatus ? `; status ${item.latestStatus}` : ""}
                    </p>
                  </div>
                  <span className="pill pill-warning">Needs review</span>
                </div>
                <p className="status-copy">{item.warnings[0]?.message}</p>
                <div className="action-row compact-action-row">
                  <Button type="button" className="button-secondary icon-button" onClick={onOpenSessions} title="Open sessions" aria-label={`Open session ${item.transactionId}`}>
                    <ArrowRight aria-hidden="true" />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
