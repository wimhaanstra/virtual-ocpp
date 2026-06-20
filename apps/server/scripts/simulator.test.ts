import { describe, expect, it } from 'vitest';
import { inferAdminUrl, parseSimulatorArgs } from './simulator.js';

describe('simulator cli', () => {
  it('parses defaults and infers the admin URL from the OCPP endpoint', () => {
    const options = parseSimulatorArgs([], {});

    expect(options.url).toBe('ws://localhost:3000/ocpp');
    expect(options.adminUrl).toBe('http://localhost:3000');
    expect(options.chargerId).toBe('SIM-001');
    expect(options.tagId).toBe('SIM-TAG-001');
    expect(options.connectorId).toBe(1);
    expect(options.ensureTag).toBe(false);
  });

  it('parses flags, inline values, and environment defaults', () => {
    const options = parseSimulatorArgs(
      [
        '--url=wss://example.test/ocpp',
        '--charger-id',
        'DEMO-1',
        '--meter-samples',
        '2',
        '--ensure-tag',
        '--keep-open'
      ],
      {
        SIMULATOR_TAG_ID: 'TAG-FROM-ENV',
        ADMIN_USERNAME: 'admin-env',
        ADMIN_PASSWORD: 'password-env'
      }
    );

    expect(options.url).toBe('wss://example.test/ocpp');
    expect(options.adminUrl).toBe('https://example.test');
    expect(options.chargerId).toBe('DEMO-1');
    expect(options.tagId).toBe('TAG-FROM-ENV');
    expect(options.meterSamples).toBe(2);
    expect(options.ensureTag).toBe(true);
    expect(options.keepOpen).toBe(true);
    expect(options.adminUsername).toBe('admin-env');
    expect(options.adminPassword).toBe('password-env');
  });

  it('rejects invalid numeric options', () => {
    expect(() => parseSimulatorArgs(['--connector-id', '0'], {})).toThrow('--connector-id must be at least 1');
    expect(() => parseSimulatorArgs(['--meter-samples', '-1'], {})).toThrow('--meter-samples must be a non-negative integer');
  });

  it('infers admin URLs from websocket endpoints', () => {
    expect(inferAdminUrl('ws://127.0.0.1:3000/ocpp')).toBe('http://127.0.0.1:3000');
    expect(inferAdminUrl('wss://charge.example/ocpp/SIM-1')).toBe('https://charge.example');
  });
});
