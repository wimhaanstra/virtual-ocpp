import { BatteryCharging, Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChargerRegistryRow } from "../types";
import { getChargerContextId, getChargerDisplayLabel, sortChargers } from "../app-helpers";
import { Button } from "./ui/button";

type ChargerContextSwitcherProps = {
  chargers: ChargerRegistryRow[];
  selectedChargerId: string;
  selectedChargerLabel: string;
  status?: string;
  statusTone?: string;
  variant?: "page" | "sidebar" | "mobile";
  collapsed?: boolean;
  onSelectCharger: (chargerId: string) => void;
};

export function ChargerContextSwitcher({
  chargers,
  selectedChargerId,
  selectedChargerLabel,
  status,
  statusTone = "pill-neutral",
  variant = "page",
  collapsed = false,
  onSelectCharger
}: ChargerContextSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const sidebarSelectRef = useRef<HTMLElement | null>(null);
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
  const displayCharger = selectedCharger ?? (sortedChargers.length === 1 ? sortedChargers[0] : null);
  const displayChargerId = displayCharger ? getChargerContextId(displayCharger) : selectedChargerId;
  const selectedIdLabel = displayChargerId || "No charger selected";
  const canSwitch = sortedChargers.length > 1;
  const title = selectedCharger ? selectedChargerLabel : displayCharger ? getChargerDisplayLabel(displayCharger) : sortedChargers.length === 0 ? "No chargers" : "Select a charger";
  const ariaLabel = variant === "mobile" ? "Selected charger mobile" : "Selected charger";

  useEffect(() => {
    if (variant !== "sidebar" || !open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const container = sidebarSelectRef.current;
      if (!container || !(event.target instanceof Node)) return;
      if (!container.contains(event.target)) setOpen(false);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, variant]);

  if (variant === "sidebar") {
    return (
      <section ref={sidebarSelectRef} className={`sidebar-charger-select ${collapsed ? "sidebar-charger-select-collapsed" : ""}`} aria-label={ariaLabel}>
        {collapsed ? (
          <span className="sidebar-charger-select__icon" aria-hidden="true" title={title}>
            <BatteryCharging />
          </span>
        ) : (
          <>
            <button
              type="button"
              className="sidebar-charger-select__control"
              onClick={() => {
                if (canSwitch) setOpen((current) => !current);
              }}
              disabled={!canSwitch}
              aria-haspopup="listbox"
              aria-expanded={canSwitch ? open : undefined}
              aria-label="Select charger"
              title={selectedIdLabel}
            >
              <span>{title}</span>
              {canSwitch ? <ChevronDown aria-hidden="true" /> : null}
            </button>

            {open && canSwitch ? (
              <div className="sidebar-charger-select__menu" role="listbox" aria-label="Chargers">
                {sortedChargers.map((charger) => {
                  const chargerId = getChargerContextId(charger);
                  const selected = chargerId === selectedChargerId;

                  return (
                    <button
                      type="button"
                      className={`sidebar-charger-select__option ${selected ? "active" : ""}`}
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        onSelectCharger(chargerId);
                        setOpen(false);
                      }}
                      key={charger.id}
                    >
                      <span className="sidebar-charger-select__option-copy">
                        <strong>{getChargerDisplayLabel(charger)}</strong>
                        <span className="mono">{chargerId}</span>
                      </span>
                      <span className={`pill ${charger.active ? "pill-good" : "pill-neutral"}`}>
                        {charger.active ? "Online" : "Registered"}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </>
        )}
      </section>
    );
  }

  const openPicker = () => {
    if (!canSwitch) return;
    setOpen(true);
  };

  return (
    <>
      <section
        className={`charger-context-strip charger-context-strip-${variant} ${collapsed ? "charger-context-strip-collapsed" : ""}`}
        aria-label={ariaLabel}
      >
        <button type="button" className="charger-context-strip__trigger" onClick={openPicker} disabled={!canSwitch} title={title}>
          <span className="charger-context-strip__icon" aria-hidden="true">
            <BatteryCharging />
          </span>
          <span className="charger-context-strip__copy">
            {variant === "page" ? <span className="eyebrow">Charger context</span> : null}
            <strong>{title}</strong>
            {!collapsed ? <span className="mono">{selectedIdLabel}</span> : null}
          </span>
        </button>
        <div className="charger-context-strip__actions">
          {status && !collapsed ? <span className={`pill ${statusTone}`}>{status}</span> : null}
          {canSwitch ? (
            <Button type="button" className="button-secondary compact-text-button charger-context-strip__switch" onClick={() => setOpen(true)}>
              {selectedCharger ? "Switch" : "Select"}
            </Button>
          ) : null}
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
