import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, RotateCcw, X } from "lucide-react";
import { Button } from "./ui/button";

export type FilterChip<TKey extends string> = {
  key: TKey;
  label: string;
};

type ActiveFilterChipRowProps<TKey extends string> = {
  ariaLabel: string;
  chips: Array<FilterChip<TKey>>;
  emptyLabel: string;
  prefixChip?: ReactNode;
  onRemove: (key: TKey, label: string) => void;
};

export function ActiveFilterChipRow<TKey extends string>({ ariaLabel, chips, emptyLabel, prefixChip, onRemove }: ActiveFilterChipRowProps<TKey>) {
  return (
    <div className="filter-chip-row active-filter-chip-row" aria-label={ariaLabel}>
      {prefixChip}
      {chips.length > 0 ? (
        chips.map((chip) => (
          <span className="filter-chip removable-filter-chip" key={chip.key}>
            {chip.label}
            <button type="button" onClick={() => onRemove(chip.key, chip.label)} aria-label={`Remove ${chip.label} filter`} title={`Remove ${chip.label} filter`}>
              <X aria-hidden="true" />
            </button>
          </span>
        ))
      ) : (
        <span className="filter-chip filter-chip-muted">{emptyLabel}</span>
      )}
    </div>
  );
}

type FilterPanelProps<TKey extends string> = {
  activeCount: number;
  ariaLabel: string;
  chips: Array<FilterChip<TKey>>;
  children: ReactNode;
  emptyChipLabel: string;
  busy: boolean;
  meta?: ReactNode;
  prefixChip?: ReactNode;
  validationError?: string;
  onRemove: (key: TKey, label: string) => void;
  onReset: () => void;
};

export function FilterPanel<TKey extends string>({
  activeCount,
  ariaLabel,
  chips,
  children,
  emptyChipLabel,
  busy,
  meta,
  prefixChip,
  validationError,
  onRemove,
  onReset
}: FilterPanelProps<TKey>) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className={`panel filter-panel ${expanded ? "filter-panel-expanded" : "filter-panel-collapsed"}`}>
      <div className="filter-panel__header">
        <ActiveFilterChipRow ariaLabel={ariaLabel} chips={chips} emptyLabel={emptyChipLabel} prefixChip={prefixChip} onRemove={onRemove} />
        <div className="filter-panel__meta">
          <span>{activeCount} active</span>
          {meta}
          <Button
            type="button"
            className="button-secondary compact-text-button overview-section-action filter-panel__reset"
            onClick={onReset}
            disabled={busy || activeCount === 0}
            title="Reset filters"
            aria-label="Reset filters"
          >
            <RotateCcw aria-hidden="true" />
            Reset
          </Button>
          <Button
            type="button"
            className="button-secondary icon-button overview-icon-action filter-panel__toggle"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            title={expanded ? "Collapse filters" : "Expand filters"}
            aria-label={expanded ? "Collapse filters" : "Expand filters"}
          >
            {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </Button>
        </div>
      </div>
      <div className="filter-panel__form" hidden={!expanded}>
        {children}
        {validationError ? <p className="field-error">{validationError}</p> : null}
      </div>
    </section>
  );
}

type FilterGridProps = {
  children: ReactNode;
  columns?: "primary" | "sessions" | "advanced";
};

export function FilterGrid({ children, columns = "primary" }: FilterGridProps) {
  return <div className={`filter-grid filter-grid--${columns}`}>{children}</div>;
}

type FilterFieldProps = {
  children: ReactNode;
  label: string;
};

export function FilterField({ children, label }: FilterFieldProps) {
  return (
    <label className="field filter-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export type FilterSelectOption = {
  value: string;
  label: string;
  description?: string;
};

type FilterSelectProps = {
  ariaLabel: string;
  options: FilterSelectOption[];
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export function FilterSelect({ ariaLabel, disabled = false, onChange, options, value }: FilterSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const selectedOption = options.find((option) => option.value === value) ?? options[0] ?? { value: "", label: "Any" };

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const container = ref.current;
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
  }, [open]);

  return (
    <div className="filter-select" ref={ref}>
      <button
        type="button"
        className="filter-select__control"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selectedOption.label}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <div className="filter-select__menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                type="button"
                className={`filter-select__option ${selected ? "active" : ""}`}
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                key={`${option.value}-${option.label}`}
              >
                <span className="filter-select__option-copy">
                  <strong>{option.label}</strong>
                  {option.description ? <span>{option.description}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
