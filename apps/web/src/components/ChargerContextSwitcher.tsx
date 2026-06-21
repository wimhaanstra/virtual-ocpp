import { BatteryCharging, Check, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { ChargerRegistryRow } from "../types";
import { getChargerContextId, getChargerDisplayLabel, sortChargers } from "../app-helpers";
import { Button } from "./ui/button";

type ChargerContextSwitcherProps = {
  chargers: ChargerRegistryRow[];
  selectedChargerId: string;
  selectedChargerLabel: string;
  status?: string;
  statusTone?: string;
  onSelectCharger: (chargerId: string) => void;
};

export function ChargerContextSwitcher({
  chargers,
  selectedChargerId,
  selectedChargerLabel,
  status,
  statusTone = "pill-neutral",
  onSelectCharger
}: ChargerContextSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const sortedChargers = useMemo(() => sortChargers(chargers), [chargers]);
  const filteredChargers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sortedChargers;

    return sortedChargers.filter((charger) => {
      const label = getChargerDisplayLabel(charger).toLowerCase();
      const id = getChargerContextId(charger).toLowerCase();
      return label.includes(needle) || id.includes(needle);
    });
  }, [query, sortedChargers]);

  const selectedCharger = sortedChargers.find((charger) => getChargerContextId(charger) === selectedChargerId) ?? null;
  const selectedIdLabel = selectedChargerId || "No charger selected";

  return (
    <>
      <section className="charger-context-strip" aria-label="Selected charger">
        <div className="charger-context-strip__icon" aria-hidden="true">
          <BatteryCharging />
        </div>
        <div className="charger-context-strip__copy">
          <span className="eyebrow">Charger context</span>
          <strong>{selectedCharger ? selectedChargerLabel : "Select a charger"}</strong>
          <span className="mono">{selectedIdLabel}</span>
        </div>
        <div className="charger-context-strip__actions">
          {status ? <span className={`pill ${statusTone}`}>{status}</span> : null}
          <Button type="button" className="button-secondary" onClick={() => setOpen(true)}>
            {selectedCharger ? "Switch" : "Select"}
          </Button>
        </div>
      </section>

      {open ? (
        <div className="modal-backdrop" role="presentation">
          <section className="panel modal-panel charger-picker-modal" role="dialog" aria-modal="true" aria-labelledby="charger-picker-title">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Charger context</p>
                <h2 id="charger-picker-title">Select charger</h2>
                <p className="status-copy">Choose the charger for this page.</p>
              </div>
              <Button type="button" className="button-ghost icon-button" onClick={() => setOpen(false)} aria-label="Close charger picker">
                <X aria-hidden="true" />
              </Button>
            </div>
            <label className="field charger-picker-search">
              <span>Search</span>
              <div className="input-with-icon">
                <Search aria-hidden="true" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search charger name or ID" autoFocus />
              </div>
            </label>
            {filteredChargers.length === 0 ? (
              <p>No chargers match your search.</p>
            ) : (
              <div className="charger-picker-list">
                {filteredChargers.map((charger) => {
                  const chargerId = getChargerContextId(charger);
                  const selected = chargerId === selectedChargerId;

                  return (
                    <button
                      type="button"
                      className={`charger-picker-row ${selected ? "active" : ""}`}
                      onClick={() => {
                        onSelectCharger(chargerId);
                        setOpen(false);
                      }}
                      key={charger.id}
                    >
                      <span>
                        <strong>{getChargerDisplayLabel(charger)}</strong>
                        <span className="mono">{chargerId}</span>
                      </span>
                      <span className={`pill ${charger.active ? "pill-good" : "pill-neutral"}`}>
                        {charger.active ? "Connected" : "Registered"}
                      </span>
                      {selected ? <Check aria-hidden="true" /> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
