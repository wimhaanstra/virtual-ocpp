import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/http-client.js';
import { executeTool, listToolDefinitions } from '../src/tools.js';

describe('mcp tool catalog', () => {
  it('does not expose a raw request tool', () => {
    const names = listToolDefinitions().map((tool) => tool.name);
    expect(names.some((name) => /request|raw/i.test(name))).toBe(false);
  });

  it('exposes SmartEVSE diagnostics as a curated read tool', () => {
    const names = listToolDefinitions().map((tool) => tool.name);
    expect(names).toContain('diagnostics_smartevse');
  });
});

describe('tool execution', () => {
  it('calls the API with bearer auth and serializes results', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([{ id: 'charger-1', enabled: true }]), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    );
    const client = createApiClient({
      baseUrl: 'https://api.example.test/',
      token: 'secret-token',
      fetchImpl: fetchImpl as typeof fetch
    });

    const result = await executeTool(client, 'chargers_list', { chargerId: 'charger-1' });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url).toBeInstanceOf(URL);
    expect(String(url)).toBe('https://api.example.test/api/chargers?chargerId=charger-1');
    expect(init).toMatchObject({
      method: 'GET',
      headers: {
        authorization: 'Bearer secret-token',
        accept: 'application/json'
      }
    });
    expect(result.isError).not.toBe(true);
    expect(result.content[0]?.text).toContain('charger-1');
  });

  it('sanitizes upstream auth failures', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('token=secret-token should never be echoed', {
        status: 401,
        headers: {
          'content-type': 'text/plain'
        }
      })
    );
    const client = createApiClient({
      baseUrl: 'https://api.example.test/',
      token: 'secret-token',
      fetchImpl: fetchImpl as typeof fetch
    });

    const result = await executeTool(client, 'tags_list', {});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('authentication token was rejected');
    expect(result.content[0]?.text).not.toContain('secret-token');
  });

  it('reports validation issues without leaking internals', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.example.test/',
      token: 'secret-token',
      fetchImpl: vi.fn() as unknown as typeof fetch
    });

    const result = await executeTool(client, 'chargers_change_configuration', { chargerId: 'c-1' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('key');
    expect(result.content[0]?.text).not.toContain('secret-token');
  });
});
