import { useState } from "react";
import { Pencil, Plus, RefreshCcw, Trash2 } from "lucide-react";
import type { ChargerRegistryRow } from "../types";
import { formatDateTime, getChargerConnectionLabel, getChargerConnectionTone } from "../app-helpers";
import { ExpandableDataTable, type ExpandableDataTableColumn } from "./ExpandableDataTable";
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
  const expandedChargerIds = new Set(expandedChargerId ? [expandedChargerId] : []);
  const columns: Array<ExpandableDataTableColumn<ChargerRegistryRow>> = [
    {
      key: "charger",
      header: "Charger",
      render: (charger) => (
        <div className="session-table-primary">
          <strong className="table-truncate" title={charger.label?.trim() || "Unlabeled"}>
            {charger.label?.trim() || "Unlabeled"}
          </strong>
          <span className="mono table-truncate" title={charger.id}>
            {charger.id}
          </span>
        </div>
      )
    },
    {
      key: "status",
      header: "Status",
      render: (charger) => {
        const status = getChargerStatus(charger);
        return <span className={`pill overview-status-pill ${status.tone}`}>{status.label}</span>;
      }
    },
    {
      key: "last-seen",
      header: "Last seen",
      render: (charger) => <strong>{formatDateTime(charger.lastSeenAt ?? charger.connectedAt ?? charger.updatedAt ?? null)}</strong>
    },
    {
      key: "hardware",
      header: "Hardware",
      render: (charger) => {
        const hardware = [charger.chargePointVendor, charger.chargePointModel].filter(Boolean).join(" / ");
        return (
          <div className="session-table-primary">
            <strong className="table-truncate" title={hardware || "-"}>
              {hardware || "-"}
            </strong>
            <span className="table-truncate" title={charger.firmwareVersion ? `Firmware ${charger.firmwareVersion}` : "Firmware -"}>
              {charger.firmwareVersion ? `Firmware ${charger.firmwareVersion}` : "Firmware -"}
            </span>
          </div>
        );
      }
    },
    {
      key: "actions",
      headingClassName: "sessions-table__actions-heading",
      header: "Actions",
      cellClassName: "session-table-cell session-table-cell--actions",
      stopPropagation: true,
      render: (charger) => (
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
      )
    }
  ];

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
        <ExpandableDataTable
          columns={columns}
          expandedRowIds={expandedChargerIds}
          getRowDetailsLabel={(charger) => `charger ${charger.id}`}
          getRowId={(charger) => charger.id}
          onToggleRow={(chargerId) => setExpandedChargerId(expandedChargerId === chargerId ? null : chargerId)}
          renderExpandedRow={(charger) => <ChargerDetails charger={charger} />}
          rows={chargers}
          tableClassName="chargers-table"
          wrapClassName="chargers-table-wrap"
        />
      )}
    </section>
  );
}

function ChargerDetails({ charger }: { charger: ChargerRegistryRow }) {
  return (
    <>
      {charger.connectionWarning ? (
        <div className="session-audit-row charger-warning-row">
          <div className="session-audit-inline">{charger.connectionWarning.message}</div>
        </div>
      ) : null}
      <div className="session-detail-row">
        <div className="session-detail-grid">
          <span className="session-detail-item">
            <span>Charger ID</span>
            <strong className="mono table-truncate" title={charger.id}>
              {charger.id}
            </strong>
          </span>
          <span className="session-detail-item">
            <span>Label</span>
            <strong className="table-truncate" title={charger.label?.trim() || "Unlabeled"}>
              {charger.label?.trim() || "Unlabeled"}
            </strong>
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
            <strong className="table-truncate" title={charger.chargePointVendor || "-"}>
              {charger.chargePointVendor || "-"}
            </strong>
          </span>
          <span className="session-detail-item">
            <span>Model</span>
            <strong className="table-truncate" title={charger.chargePointModel || "-"}>
              {charger.chargePointModel || "-"}
            </strong>
          </span>
          <span className="session-detail-item">
            <span>Firmware</span>
            <strong className="table-truncate" title={charger.firmwareVersion || "-"}>
              {charger.firmwareVersion || "-"}
            </strong>
          </span>
          <span className="session-detail-item">
            <span>Updated</span>
            <strong>{formatDateTime(charger.updatedAt ?? null)}</strong>
          </span>
        </div>
      </div>
    </>
  );
}
