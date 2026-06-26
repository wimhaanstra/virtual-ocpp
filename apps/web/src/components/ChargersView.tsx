import { useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Plus, RefreshCcw, Trash2 } from "lucide-react";
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
  const [expandedChargerId, setExpandedChargerId] = useState<string | null>(null);

  return (
    <section className="chargers-page">
      <div className="dashboard-section-header">
        <div>
          <p className="eyebrow">Registry</p>
          <h2>Chargers</h2>
        </div>
        <div className="dashboard-section-header__actions">
          <Button type="button" className="button-secondary icon-button overview-icon-action" onClick={onRefresh} disabled={busy} title="Refresh" aria-label="Refresh">
            <RefreshCcw aria-hidden="true" />
          </Button>
          <Button type="button" className="icon-button overview-icon-action" onClick={onAddCharger} disabled={busy} title="Add charger" aria-label="Add charger">
            <Plus aria-hidden="true" />
          </Button>
        </div>
      </div>
      {chargers.length === 0 ? (
        <p className="dashboard-empty-state">No chargers registered yet.</p>
      ) : (
        <div className="sessions-table-wrap chargers-table-wrap">
          <table className="sessions-table chargers-table">
            <thead>
              <tr>
                <th aria-label="Expand charger details" />
                <th>Charger</th>
                <th>Status</th>
                <th>Last seen</th>
                <th>Hardware</th>
                <th className="sessions-table__actions-heading">Actions</th>
              </tr>
            </thead>
            <tbody>
              {chargers.map((charger) => {
                const status = getChargerStatus(charger);
                const hardware = [charger.chargePointVendor, charger.chargePointModel].filter(Boolean).join(" / ");
                const expanded = expandedChargerId === charger.id;

                return (
                  <ChargerTableRow
                    busy={busy}
                    charger={charger}
                    expanded={expanded}
                    hardware={hardware}
                    key={charger.id}
                    onDelete={onDelete}
                    onEditLabel={onEditLabel}
                    onToggleExpanded={() => setExpandedChargerId(expanded ? null : charger.id)}
                    status={status}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type ChargerTableRowProps = {
  busy: boolean;
  charger: ChargerRegistryRow;
  expanded: boolean;
  hardware: string;
  onDelete: (charger: ChargerRegistryRow) => void;
  onEditLabel: (charger: ChargerRegistryRow) => void;
  onToggleExpanded: () => void;
  status: ReturnType<typeof getChargerStatus>;
};

function ChargerTableRow({ busy, charger, expanded, hardware, onDelete, onEditLabel, onToggleExpanded, status }: ChargerTableRowProps) {
  return (
    <>
      <tr
        className="session-table-row charger-table-row"
        tabIndex={0}
        onClick={onToggleExpanded}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggleExpanded();
          }
        }}
      >
        <td className="session-table-cell session-table-cell--expand">
          <Button
            type="button"
            className="button-secondary icon-button overview-icon-action session-expand-button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpanded();
            }}
            title={expanded ? "Hide charger details" : "Show charger details"}
            aria-label={`${expanded ? "Hide" : "Show"} details for charger ${charger.id}`}
          >
            {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </Button>
        </td>
        <td>
          <div className="session-table-primary">
            <strong>{charger.label?.trim() || "Unlabeled"}</strong>
            <span className="mono">{charger.id}</span>
          </div>
        </td>
        <td>
          <span className={`pill overview-status-pill ${status.tone}`}>{status.label}</span>
        </td>
        <td>
          <strong>{formatDateTime(charger.lastSeenAt ?? charger.connectedAt ?? charger.updatedAt ?? null)}</strong>
        </td>
        <td>
          <div className="session-table-primary">
            <strong>{hardware || "-"}</strong>
            <span>{charger.firmwareVersion ? `Firmware ${charger.firmwareVersion}` : "Firmware -"}</span>
          </div>
        </td>
        <td className="session-table-cell session-table-cell--actions" onClick={(event) => event.stopPropagation()}>
          <div className="dashboard-item__actions session-table-actions">
            <Button
              type="button"
              className="button-secondary icon-button overview-icon-action"
              onClick={() => onEditLabel(charger)}
              disabled={busy}
              title="Edit label"
              aria-label="Edit label"
            >
              <Pencil aria-hidden="true" />
            </Button>
            <Button
              type="button"
              className="button-danger icon-button overview-icon-action"
              onClick={() => onDelete(charger)}
              disabled={busy}
              title="Delete charger"
              aria-label="Delete"
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr className="session-detail-table-row charger-detail-table-row">
          <td colSpan={6}>
            {charger.connectionWarning ? (
              <div className="session-audit-row charger-warning-row">
                <div className="session-audit-inline">{charger.connectionWarning.message}</div>
              </div>
            ) : null}
            <div className="session-detail-row">
              <div className="session-detail-grid">
                <span className="session-detail-item">
                  <span>Charger ID</span>
                  <strong className="mono">{charger.id}</strong>
                </span>
                <span className="session-detail-item">
                  <span>Label</span>
                  <strong>{charger.label?.trim() || "Unlabeled"}</strong>
                </span>
                <span className="session-detail-item">
                  <span>First seen</span>
                  <strong>{formatDateTime(charger.firstSeenAt ?? null)}</strong>
                </span>
                <span className="session-detail-item">
                  <span>Last seen</span>
                  <strong>{formatDateTime(charger.lastSeenAt ?? null)}</strong>
                </span>
                <span className="session-detail-item">
                  <span>Connected</span>
                  <strong>{formatDateTime(charger.connectedAt ?? null)}</strong>
                </span>
                <span className="session-detail-item">
                  <span>Disconnected</span>
                  <strong>{formatDateTime(charger.disconnectedAt ?? null)}</strong>
                </span>
                <span className="session-detail-item">
                  <span>Vendor</span>
                  <strong>{charger.chargePointVendor || "-"}</strong>
                </span>
                <span className="session-detail-item">
                  <span>Model</span>
                  <strong>{charger.chargePointModel || "-"}</strong>
                </span>
                <span className="session-detail-item">
                  <span>Firmware</span>
                  <strong>{charger.firmwareVersion || "-"}</strong>
                </span>
                <span className="session-detail-item">
                  <span>Updated</span>
                  <strong>{formatDateTime(charger.updatedAt ?? null)}</strong>
                </span>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
