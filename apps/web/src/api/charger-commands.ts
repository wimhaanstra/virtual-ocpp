import { readErrorResponse, type UnauthorizedHandler } from "./client";

export async function requestChargerCommand<T>(
  chargerId: string,
  action: string,
  body: Record<string, unknown>,
  handleUnauthorized: UnauthorizedHandler
) {
  const response = await fetch(`/api/chargers/${encodeURIComponent(chargerId)}/commands/${action}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (handleUnauthorized(response)) return null;

  if (response.status === 404) {
    throw new Error("This OCPP command endpoint is not available yet.");
  }

  if (!response.ok) {
    const error = await readErrorResponse(response);
    if (response.status === 409) {
      throw new Error(error === "charger_not_connected" ? "Charger is not connected." : "Charger rejected the command because it is not ready.");
    }
    if (response.status === 503) {
      throw new Error("Command service is unavailable.");
    }
    throw new Error(error ?? "Could not send charger command.");
  }

  return (await response.json().catch(() => null)) as T | null;
}

export function getChargerConfiguration(chargerId: string, keys: string[], handleUnauthorized: UnauthorizedHandler) {
  return requestChargerCommand(chargerId, "get-configuration", { key: keys }, handleUnauthorized);
}

export function changeChargerConfiguration(chargerId: string, key: string, value: string, handleUnauthorized: UnauthorizedHandler) {
  return requestChargerCommand(chargerId, "change-configuration", { key, value }, handleUnauthorized);
}

export function triggerChargerMessage(
  chargerId: string,
  requestedMessage: string,
  connectorId: number | null,
  handleUnauthorized: UnauthorizedHandler
) {
  return requestChargerCommand(
    chargerId,
    "trigger-message",
    connectorId === null ? { requestedMessage } : { requestedMessage, connectorId },
    handleUnauthorized
  );
}
