import { describe, expect, it } from 'vitest';
import { inferAdminUrl, parseDurationMs, parseSimulatorArgs } from './simulator.js';

describe('simulator cli', () => {
  it('parses defaults and infers the admin URL from the OCPP endpoint', () => {
    const options = parseSimulatorArgs([], {});

    expect(options.url).toBe('ws://localhost:3000/ocpp');
    expect(options.adminUrl).toBe('http://localhost:3000');
    expect(options.chargerId).toBe('SIM-001');
    expect(options.tagId).toBe('SIM-TAG-001');
    expect(options.connectorId).toBe(1);
    expect(options.runTimeMs).toBeNull();
    expect(options.powerKw).toBeNull();
    expect(options.ensureTag).toBe(false);
    expect(options.smoke).toBe(false);
  });

  it('parses flags, inline values, and environment defaults', () => {
    const options = parseSimulatorArgs(
      [
        '--url=wss://example.test/ocpp',
        '--charger-id',
        'DEMO-1',
        '--meter-samples',
        '2',
        '--run-time=15m',
        '--power-kw',
        '11.5',
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
    expect(options.runTimeMs).toBe(900_000);
    expect(options.powerKw).toBe(11.5);
    expect(options.sampleIntervalMs).toBe(60_000);
    expect(options.ensureTag).toBe(true);
    expect(options.keepOpen).toBe(true);
    expect(options.adminUsername).toBe('admin-env');
    expect(options.adminPassword).toBe('password-env');
  });

  it('rejects invalid numeric options', () => {
    expect(() => parseSimulatorArgs(['--connector-id', '0'], {})).toThrow('--connector-id must be at least 1');
    expect(() => parseSimulatorArgs(['--meter-samples', '-1'], {})).toThrow('--meter-samples must be a non-negative integer');
    expect(() => parseSimulatorArgs(['--power-kw', '0'], {})).toThrow('--power-kw must be a positive number');
    expect(() => parseSimulatorArgs(['--run-time', 'forever'], {})).toThrow('--run-time must be a duration');
  });

  it('parses smoke mode with fast deterministic defaults', () => {
    const options = parseSimulatorArgs(['--smoke'], {
      ADMIN_PASSWORD: 'password-env'
    });

    expect(options.chargerId).toBe('SMOKE-001');
    expect(options.tagId).toBe('SMOKE-TAG-001');
    expect(options.meterSamples).toBe(2);
    expect(options.meterStepWh).toBe(250);
    expect(options.sampleIntervalMs).toBe(100);
    expect(options.ensureTag).toBe(true);
    expect(options.smoke).toBe(true);
    expect(options.adminPassword).toBe('password-env');
  });

  it('infers admin URLs from websocket endpoints', () => {
    expect(inferAdminUrl('ws://127.0.0.1:3000/ocpp')).toBe('http://127.0.0.1:3000');
    expect(inferAdminUrl('wss://charge.example/ocpp/SIM-1')).toBe('https://charge.example');
  });

  it('parses duration strings', () => {
    expect(parseDurationMs('1500ms', 'run-time')).toBe(1500);
    expect(parseDurationMs('90s', 'run-time')).toBe(90_000);
    expect(parseDurationMs('15m', 'run-time')).toBe(900_000);
    expect(parseDurationMs('1h30m', 'run-time')).toBe(5_400_000);
    expect(parseDurationMs('5000', 'run-time')).toBe(5000);
  });
});
