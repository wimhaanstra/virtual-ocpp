import { Pencil, Plus, RefreshCcw, Trash2 } from "lucide-react";
import type { ChargerRegistryRow } from "../types";
import { formatDateTime, getChargerConnectionLabel, getChargerConnectionTone } from "../app-helpers";
import { Button } from "./ui/button";

type ChargersViewProps = {
  busy: boolean;
  chargers: ChargerRegistryRow[];
  onAddCharger: () => void;
  onEditLabel: (charger: ChargerRegistryRow) => void;
  onRefresh: () => void;
  onDelete: (charger: ChargerRegistryRow) => void;
};

function getChargerStatus(charger: ChargerRegistryRow) {
  return { label: getChargerConnectionLabel(charger), tone: getChargerConnectionTone(charger) };
}

export function ChargersView({ busy, chargers, onAddCharger, onEditLabel, onRefresh, onDelete }: ChargersViewProps) {
  return (
    <section className="panel table-panel">
      <div className="topbar-actions page-section-header">
        <div>
          <p className="eyebrow">Registry</p>
          <h2>Chargers</h2>
          <p className="status-copy">Global charger registry with rename and destructive delete actions.</p>
        </div>
        <div className="action-row compact-action-row">
          <Button type="button" className="button-secondary icon-button" onClick={onRefresh} disabled={busy} title="Refresh" aria-label="Refresh">
            <RefreshCcw aria-hidden="true" />
          </Button>
          <Button type="button" className="icon-button" onClick={onAddCharger} disabled={busy} title="Add charger" aria-label="Add charger">
            <Plus aria-hidden="true" />
          </Button>
        </div>
      </div>
      {chargers.length === 0 ? (
        <p>No chargers registered yet.</p>
      ) : (
        <div className="record-list registry-list charger-list">
          {chargers.map((charger) => {
            const status = getChargerStatus(charger);
            const hardware = [charger.chargePointVendor, charger.chargePointModel].filter(Boolean).join(" / ");

            return (
              <article className="record-card registry-card charger-card" key={charger.id}>
                <div className="record-card__summary">
                  <div>
                    <div className="record-card__title">{charger.label?.trim() || "Unlabeled"}</div>
                    <div className="record-card__subtitle mono">{charger.id}</div>
                  </div>
                  <span className={`pill ${status.tone}`}>{status.label}</span>
                </div>
                {charger.connectionWarning ? <p className="notice notice-warning compact-notice">{charger.connectionWarning.message}</p> : null}
                <dl className="detail-grid compact-detail-grid">
                  <div>
                    <dt>First seen</dt>
                    <dd>{formatDateTime(charger.firstSeenAt ?? null)}</dd>
                  </div>
                  <div>
                    <dt>Last seen</dt>
                    <dd>{formatDateTime(charger.lastSeenAt ?? null)}</dd>
                  </div>
                  <div>
                    <dt>Connected at</dt>
                    <dd>{formatDateTime(charger.connectedAt ?? null)}</dd>
                  </div>
                  <div>
                    <dt>Hardware</dt>
                    <dd>
                      {hardware || "-"}
                      {charger.firmwareVersion ? <span className="detail-subvalue mono">Firmware {charger.firmwareVersion}</span> : null}
                    </dd>
                  </div>
                </dl>
                <div className="record-card__actions">
                  <div className="action-row compact-action-row">
                    <Button
                      type="button"
                      className="button-secondary icon-button"
                      onClick={() => onEditLabel(charger)}
                      disabled={busy}
                      title="Edit label"
                      aria-label="Edit label"
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      className="button-danger icon-button"
                      onClick={() => onDelete(charger)}
                      disabled={busy}
                      title="Delete charger"
                      aria-label="Delete"
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
