import { useState, type FormEvent } from "react";
import { CheckCircle2, RefreshCcw, Send } from "lucide-react";
import { Button } from "./ui/button";

type CommandState = {
  status: "idle" | "loading" | "success" | "error";
  message: string;
  result: unknown | null;
};

type ChargerDiagnosticsPanelProps = {
  busy: boolean;
  selectedChargerId: string;
  onGetConfiguration: (chargerId: string, keys: string[]) => Promise<unknown>;
  onChangeConfiguration: (chargerId: string, key: string, value: string) => Promise<unknown>;
  onTriggerMessage: (chargerId: string, requestedMessage: string, connectorId: number | null) => Promise<unknown>;
};

const getConfigurationCommonKeys = [
  "HeartbeatInterval",
  "MeterValueSampleInterval",
  "ClockAlignedDataInterval",
  "MeterValuesSampledData",
  "StopTxnSampledData"
];

const changeConfigurationPresets = [
  { key: "HeartbeatInterval", value: "60" },
  { key: "MeterValueSampleInterval", value: "60" },
  { key: "ClockAlignedDataInterval", value: "300" },
  { key: "MeterValuesSampledData", value: "Energy.Active.Import.Register,Power.Active.Import,Current.Import,Voltage,Temperature" },
  { key: "StopTxnSampledData", value: "Energy.Active.Import.Register" }
];

const triggerMessageOptions = [
  "BootNotification",
  "Heartbeat",
  "FirmwareStatusNotification",
  "DiagnosticsStatusNotification",
  "StatusNotification",
  "MeterValues"
];

const triggerMessageConnectorRequired = new Set(["StatusNotification", "MeterValues"]);

function emptyCommandState(): CommandState {
  return {
    status: "idle",
    message: "",
    result: null
  };
}

function parseKeys(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formatResult(result: unknown) {
  if (result === null || typeof result !== "object") {
    return String(result ?? "");
  }

  return JSON.stringify(result, null, 2);
}

export function ChargerDiagnosticsPanel({
  busy,
  selectedChargerId,
  onGetConfiguration,
  onChangeConfiguration,
  onTriggerMessage
}: ChargerDiagnosticsPanelProps) {
  const [getKeys, setGetKeys] = useState("HeartbeatInterval, MeterValueSampleInterval");
  const [getCommandState, setGetCommandState] = useState<CommandState>(() => emptyCommandState());
  const [changeKey, setChangeKey] = useState(changeConfigurationPresets[0].key);
  const [changeValue, setChangeValue] = useState(changeConfigurationPresets[0].value);
  const [changeCustomKey, setChangeCustomKey] = useState("");
  const [changeCommandState, setChangeCommandState] = useState<CommandState>(() => emptyCommandState());
  const [triggerMessage, setTriggerMessage] = useState(triggerMessageOptions[1]);
  const [triggerConnectorId, setTriggerConnectorId] = useState("");
  const [triggerCommandState, setTriggerCommandState] = useState<CommandState>(() => emptyCommandState());

  const resolvedChangeKey = changeKey === "Custom" ? changeCustomKey.trim() : changeKey;

  async function submitGetConfiguration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedChargerId) return;

    const keys = parseKeys(getKeys);
    if (keys.length === 0) {
      setGetCommandState({
        status: "error",
        message: "Enter at least one allowlisted configuration key.",
        result: null
      });
      return;
    }
    setGetCommandState({
      status: "loading",
      message: `Requesting ${keys.length} configuration key${keys.length === 1 ? "" : "s"}...`,
      result: null
    });

    try {
      const result = await onGetConfiguration(selectedChargerId, keys);
      if (result === null) return;

      setGetCommandState({
        status: "success",
        message: `Loaded ${keys.length} requested key${keys.length === 1 ? "" : "s"}.`,
        result
      });
    } catch (error) {
      setGetCommandState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not load charger configuration.",
        result: null
      });
    }
  }

  async function submitChangeConfiguration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedChargerId || !resolvedChangeKey) return;

    setChangeCommandState({
      status: "loading",
      message: `Sending ChangeConfiguration for ${resolvedChangeKey}...`,
      result: null
    });

    try {
      const result = await onChangeConfiguration(selectedChargerId, resolvedChangeKey, changeValue);
      if (result === null) return;

      setChangeCommandState({
        status: "success",
        message: `ChangeConfiguration sent for ${resolvedChangeKey}.`,
        result
      });
    } catch (error) {
      setChangeCommandState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not send configuration change.",
        result: null
      });
    }
  }

  async function submitTriggerMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedChargerId) return;

    const connectorIdText = triggerConnectorId.trim();
    if (connectorIdText) {
      const parsedConnectorId = Number(connectorIdText);
      if (!Number.isInteger(parsedConnectorId) || parsedConnectorId < 0) {
        setTriggerCommandState({
          status: "error",
          message: "Connector id must be zero or a positive integer.",
          result: null
        });
        return;
      }
    }
    const connectorId = connectorIdText ? Number(connectorIdText) : null;

    if (triggerMessageConnectorRequired.has(triggerMessage) && connectorId === null) {
      setTriggerCommandState({
        status: "error",
        message: `${triggerMessage} needs a connector id.`,
        result: null
      });
      return;
    }

    setTriggerCommandState({
      status: "loading",
      message: `Triggering ${triggerMessage}...`,
      result: null
    });

    try {
      const result = await onTriggerMessage(selectedChargerId, triggerMessage, connectorId);
      if (result === null) return;

      setTriggerCommandState({
        status: "success",
        message: `TriggerMessage sent for ${triggerMessage}.`,
        result
      });
    } catch (error) {
      setTriggerCommandState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not trigger the charger message.",
        result: null
      });
    }
  }

  return (
    <section className="charger-diagnostics-panel" aria-label="Charger diagnostics and configuration">
      <div className="dashboard-section-header">
        <div>
          <p className="eyebrow">Diagnostics</p>
          <h2>Configuration commands</h2>
        </div>
      </div>

      {!selectedChargerId ? (
        <p className="dashboard-empty-state">Select a charger context to use diagnostics commands.</p>
      ) : (
        <div className="command-grid">
          <form className="command-card" onSubmit={submitGetConfiguration}>
            <div className="command-card__header">
              <div>
                <p className="eyebrow">GetConfiguration</p>
                <h3>Read charger settings</h3>
              </div>
              <Button
                type="submit"
                className="button-secondary icon-button overview-icon-action"
                disabled={busy || getCommandState.status === "loading"}
                title="Get configuration"
                aria-label="Get configuration"
              >
                <RefreshCcw aria-hidden="true" />
              </Button>
            </div>
            <label className="field">
              <span>Keys</span>
              <input
                value={getKeys}
                onChange={(event) => setGetKeys(event.target.value)}
                placeholder="HeartbeatInterval, MeterValueSampleInterval"
              />
              <small>Only allowlisted operational keys are accepted.</small>
            </label>
            <div className="chip-row" aria-label="Common configuration keys">
              {getConfigurationCommonKeys.map((key) => (
                <button
                  key={key}
                  type="button"
                  className="filter-chip"
                  onClick={() =>
                    setGetKeys((current) => {
                      const currentKeys = parseKeys(current);
                      return currentKeys.includes(key) ? current : [...currentKeys, key].join(", ");
                    })
                  }
                >
                  {key}
                </button>
              ))}
            </div>
            {getCommandState.status !== "idle" ? (
              <div className={`command-result command-result-${getCommandState.status}`} aria-live="polite">
                <strong>{getCommandState.message}</strong>
                {getCommandState.result ? <pre>{formatResult(getCommandState.result)}</pre> : null}
              </div>
            ) : null}
          </form>

          <form className="command-card" onSubmit={submitChangeConfiguration}>
            <div className="command-card__header">
              <div>
                <p className="eyebrow">ChangeConfiguration</p>
                <h3>Update a common key</h3>
              </div>
              <CheckCircle2 aria-hidden="true" />
            </div>
            <label className="field">
              <span>Preset</span>
              <select
                value={changeKey === "Custom" ? "Custom" : changeKey}
                onChange={(event) => {
                  const nextKey = event.target.value;
                  if (nextKey === "Custom") {
                    setChangeKey("Custom");
                    return;
                  }
                  const preset = changeConfigurationPresets.find((entry) => entry.key === nextKey);
                  if (preset) {
                    setChangeKey(preset.key);
                    setChangeValue(preset.value);
                    setChangeCustomKey("");
                  }
                }}
              >
                {changeConfigurationPresets.map((preset) => (
                  <option key={preset.key} value={preset.key}>
                    {preset.key}
                  </option>
                ))}
                <option value="Custom">Custom key</option>
              </select>
            </label>
            {changeKey === "Custom" ? (
              <label className="field">
                <span>Custom key</span>
                <input value={changeCustomKey} onChange={(event) => setChangeCustomKey(event.target.value)} placeholder="MeterValuesSampledData" />
              </label>
            ) : null}
            <label className="field">
              <span>Value</span>
              <input value={changeValue} onChange={(event) => setChangeValue(event.target.value)} placeholder="300" />
            </label>
            <div className="command-card__footer">
              <p className="status-copy">Only allowlisted operational keys are accepted by the backend.</p>
              <Button
                type="submit"
                className="button-secondary icon-button overview-icon-action"
                disabled={busy || !resolvedChangeKey.trim()}
                title="Apply configuration"
                aria-label="Apply"
              >
                <CheckCircle2 aria-hidden="true" />
              </Button>
            </div>
            {changeCommandState.status !== "idle" ? (
              <div className={`command-result command-result-${changeCommandState.status}`} aria-live="polite">
                <strong>{changeCommandState.message}</strong>
                {changeCommandState.result ? <pre>{formatResult(changeCommandState.result)}</pre> : null}
              </div>
            ) : null}
          </form>

          <form className="command-card" onSubmit={submitTriggerMessage}>
            <div className="command-card__header">
              <div>
                <p className="eyebrow">TriggerMessage</p>
                <h3>Request a charger callback</h3>
              </div>
              <Send aria-hidden="true" />
            </div>
            <label className="field">
              <span>Message</span>
              <select value={triggerMessage} onChange={(event) => setTriggerMessage(event.target.value)}>
                {triggerMessageOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Connector id</span>
              <input
                inputMode="numeric"
                value={triggerConnectorId}
                onChange={(event) => setTriggerConnectorId(event.target.value)}
                placeholder="Optional"
              />
              <small>Required for status or meter callbacks. Leave blank for charger-wide messages.</small>
            </label>
            <div className="command-card__footer">
              <p className="status-copy">The charger may return Accepted, Rejected, or NotImplemented depending on firmware support.</p>
              <Button
                type="submit"
                className="button-secondary icon-button overview-icon-action"
                disabled={busy}
                title="Trigger message"
                aria-label="Trigger"
              >
                <Send aria-hidden="true" />
              </Button>
            </div>
            {triggerCommandState.status !== "idle" ? (
              <div className={`command-result command-result-${triggerCommandState.status}`} aria-live="polite">
                <strong>{triggerCommandState.message}</strong>
                {triggerCommandState.result ? <pre>{formatResult(triggerCommandState.result)}</pre> : null}
              </div>
            ) : null}
          </form>
        </div>
      )}
    </section>
  );
}
