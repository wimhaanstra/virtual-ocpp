export type UnauthorizedHandler = (response: Response) => boolean;

export async function fetchAdminJson<T>(url: string, handleUnauthorized: UnauthorizedHandler) {
  let response: Response;
  try {
    response = await fetch(url, { credentials: "include" });
  } catch {
    return undefined;
  }
  if (handleUnauthorized(response)) return null;
  if (!response.ok) return undefined;
  return (await response.json()) as T;
}

export async function readErrorResponse(response: Response) {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === "string" ? payload.error : null;
  } catch {
    return null;
  }
}
