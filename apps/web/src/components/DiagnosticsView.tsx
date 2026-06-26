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
    <section className="diagnostics-page">
      <ChargerDiagnosticsPanel
        busy={busy}
        selectedChargerId={selectedChargerId}
        onGetConfiguration={onGetConfiguration}
        onChangeConfiguration={onChangeConfiguration}
        onTriggerMessage={onTriggerMessage}
      />

      <section className="diagnostics-section">
        <div className="dashboard-section-header">
          <div>
            <p className="eyebrow">Recovery</p>
            <h2>Meter gaps</h2>
          </div>
          <Button type="button" className="button-secondary icon-button overview-icon-action" onClick={onScanMeterGaps} disabled={busy || !selectedChargerId} title="Scan meter gaps" aria-label="Scan meter gaps">
            <RefreshCcw aria-hidden="true" />
          </Button>
        </div>
        {meterGapEvents.length > 0 ? (
          <div className="meter-gap-list">
            {meterGapEvents.slice(0, 3).map((event) => (
              <article key={event.id}>
                <div>
                  <h3>{formatEnergyWh(event.deltaWh)} gap</h3>
                  <p>
                    Connector {event.connectorId} · {formatDateTime(event.previousStoppedAt)} to {formatDateTime(event.newStartedAt)}
                  </p>
                </div>
                <div className="diagnostics-item__actions">
                  <span className="pill overview-status-pill pill-warning">{event.status}</span>
                  <Button
                    type="button"
                    className="button-secondary icon-button overview-icon-action"
                    onClick={() => onSubmitMeterGap(event)}
                    disabled={busy}
                    title="Submit recovery"
                    aria-label={`Submit meter gap ${event.id}`}
                  >
                    <CheckCircle2 aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    className="button-ghost icon-button overview-icon-action"
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
          <p className="dashboard-empty-state">No pending meter gaps.</p>
        )}
      </section>

      <section className="diagnostics-section">
        <div className="dashboard-section-header">
          <div>
            <p className="eyebrow">Session audit</p>
            <h2>Missing stop checks</h2>
          </div>
          <Button type="button" className="button-secondary icon-button overview-icon-action" onClick={onOpenSessions} title="Open sessions" aria-label="Open sessions">
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
        {auditItems.length === 0 ? (
          <p className="dashboard-empty-state">No active sessions need attention.</p>
        ) : (
          <div className="session-audit-list">
            {auditItems.map((item) => (
              <article className="session-audit-item" key={item.sessionId}>
                <div className="diagnostics-item__header">
                  <div>
                    <h3>Transaction {item.transactionId}</h3>
                    <p>
                      Connector {item.connectorId}
                      {item.latestMeterWh !== null ? `; latest meter ${formatEnergyWh(item.latestMeterWh)}` : ""}
                      {item.latestStatus ? `; status ${item.latestStatus}` : ""}
                    </p>
                  </div>
                  <span className="pill overview-status-pill pill-warning">Needs review</span>
                </div>
                <p>{item.warnings[0]?.message}</p>
                <div className="diagnostics-item__actions">
                  <Button type="button" className="button-secondary icon-button overview-icon-action" onClick={onOpenSessions} title="Open sessions" aria-label={`Open session ${item.transactionId}`}>
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
