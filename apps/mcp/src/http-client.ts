type QueryValue = string | number | boolean | null | undefined;

export class ApiError extends Error {
  constructor(
    public readonly kind: 'unauthorized' | 'forbidden' | 'not_found' | 'bad_request' | 'upstream_error' | 'network_error' | 'invalid_response',
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type ApiClient = {
  getJson<T>(path: string, query?: Record<string, QueryValue>): Promise<T>;
  getText(path: string, query?: Record<string, QueryValue>): Promise<string>;
  postJson<T>(path: string, body: unknown): Promise<T>;
  patchJson<T>(path: string, body: unknown): Promise<T>;
  putJson<T>(path: string, body: unknown): Promise<T>;
  deleteJson<T>(path: string): Promise<T>;
};

export function createApiClient(options: {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}): ApiClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl);

  return {
    async getJson<T>(path: string, query?: Record<string, QueryValue>) {
      return requestJson<T>(path, { method: 'GET', query }, fetchImpl, baseUrl, options.token);
    },
    async getText(path: string, query?: Record<string, QueryValue>) {
      return requestText(path, { method: 'GET', query }, fetchImpl, baseUrl, options.token);
    },
    async postJson<T>(path: string, body: unknown) {
      return requestJson<T>(path, { method: 'POST', body }, fetchImpl, baseUrl, options.token);
    },
    async patchJson<T>(path: string, body: unknown) {
      return requestJson<T>(path, { method: 'PATCH', body }, fetchImpl, baseUrl, options.token);
    },
    async putJson<T>(path: string, body: unknown) {
      return requestJson<T>(path, { method: 'PUT', body }, fetchImpl, baseUrl, options.token);
    },
    async deleteJson<T>(path: string) {
      return requestJson<T>(path, { method: 'DELETE' }, fetchImpl, baseUrl, options.token);
    }
  };
}

async function requestJson<T>(
  path: string,
  input: { method: string; body?: unknown; query?: Record<string, QueryValue> },
  fetchImpl: typeof fetch,
  baseUrl: string,
  token: string
) {
  const response = await send(path, input, fetchImpl, baseUrl, token);
  if (response.status === 204) {
    return undefined as T;
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError('invalid_response', 'The Virtual OCPP API returned invalid JSON.');
  }
}

async function requestText(
  path: string,
  input: { method: string; body?: unknown; query?: Record<string, QueryValue> },
  fetchImpl: typeof fetch,
  baseUrl: string,
  token: string
) {
  const response = await send(path, input, fetchImpl, baseUrl, token);
  return await response.text();
}

async function send(
  path: string,
  input: { method: string; body?: unknown; query?: Record<string, QueryValue> },
  fetchImpl: typeof fetch,
  baseUrl: string,
  token: string
) {
  const url = new URL(path, baseUrl);
  if (input.query) {
    for (const [key, value] of Object.entries(input.query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }

  try {
    const response = await fetchImpl(url, {
      method: input.method,
      headers: buildHeaders(token, input.body !== undefined),
      body: input.body === undefined ? undefined : JSON.stringify(input.body)
    });

    if (!response.ok) {
      throw toApiError(response.status);
    }

    return response;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError('network_error', 'Unable to reach the Virtual OCPP API.');
  }
}

function buildHeaders(token: string, hasBody: boolean) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: 'application/json'
  };
  if (hasBody) {
    headers['content-type'] = 'application/json';
  }
  return headers;
}

function toApiError(status: number) {
  switch (status) {
    case 400:
      return new ApiError('bad_request', 'The Virtual OCPP API rejected the request.', status);
    case 401:
      return new ApiError('unauthorized', 'The Virtual OCPP API authentication token was rejected.', status);
    case 403:
      return new ApiError('forbidden', 'The Virtual OCPP API denied the request.', status);
    case 404:
      return new ApiError('not_found', 'The requested Virtual OCPP resource was not found.', status);
    default:
      return new ApiError('upstream_error', `The Virtual OCPP API returned HTTP ${status}.`, status);
  }
}

function normalizeBaseUrl(value: string) {
  return value.endsWith('/') ? value : `${value}/`;
}
