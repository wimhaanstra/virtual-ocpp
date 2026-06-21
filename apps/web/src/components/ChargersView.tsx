import { Pencil, RefreshCcw, Trash2 } from "lucide-react";
import type { ChargerRegistryRow } from "../types";
import { formatDateTime } from "../app-helpers";
import { Button } from "./ui/button";

type ChargersViewProps = {
  busy: boolean;
  chargers: ChargerRegistryRow[];
  onEditLabel: (charger: ChargerRegistryRow) => void;
  onRefresh: () => void;
  onDelete: (charger: ChargerRegistryRow) => void;
};

function getChargerStatus(charger: ChargerRegistryRow) {
  if (charger.enabled === false) {
    return { label: "Disabled", tone: "pill-warning" };
  }

  if (charger.active) {
    return { label: "Connected", tone: "pill-good" };
  }

  return { label: "Registered", tone: "pill-neutral" };
}

export function ChargersView({ busy, chargers, onEditLabel, onRefresh, onDelete }: ChargersViewProps) {
  return (
    <section className="panel table-panel">
      <div className="topbar-actions page-section-header">
        <div>
          <p className="eyebrow">Registry</p>
          <h2>Chargers</h2>
          <p className="status-copy">Global charger registry with rename and destructive delete actions.</p>
        </div>
        <Button type="button" className="button-secondary" onClick={onRefresh} disabled={busy}>
          <RefreshCcw aria-hidden="true" />
          <span className="button-label">Refresh</span>
        </Button>
      </div>
      {chargers.length === 0 ? (
        <p>No chargers registered yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="charger-table">
            <thead>
              <tr>
                <th>Charger id</th>
                <th>Label</th>
                <th>Status</th>
                <th>First seen</th>
                <th>Last seen</th>
                <th>Connected at</th>
                <th>Hardware</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {chargers.map((charger) => {
                const status = getChargerStatus(charger);
                const hardware = [charger.chargePointVendor, charger.chargePointModel].filter(Boolean).join(" / ");

                return (
                  <tr key={charger.id}>
                    <td className="mono">{charger.id}</td>
                    <td>{charger.label?.trim() || "Unlabeled"}</td>
                    <td>
                      <span className={`pill ${status.tone}`}>{status.label}</span>
                    </td>
                    <td>{formatDateTime(charger.firstSeenAt ?? null)}</td>
                    <td>{formatDateTime(charger.lastSeenAt ?? null)}</td>
                    <td>{formatDateTime(charger.connectedAt ?? null)}</td>
                    <td>
                      {hardware || "-"}
                      {charger.firmwareVersion ? <div className="status-copy mono">Firmware {charger.firmwareVersion}</div> : null}
                    </td>
                    <td>
                      <div className="action-row">
                        <Button type="button" className="button-secondary" onClick={() => onEditLabel(charger)} disabled={busy}>
                          <Pencil aria-hidden="true" />
                          <span className="button-label">Edit label</span>
                        </Button>
                        <Button type="button" className="button-danger" onClick={() => onDelete(charger)} disabled={busy}>
                          <Trash2 aria-hidden="true" />
                          <span className="button-label">Delete</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
