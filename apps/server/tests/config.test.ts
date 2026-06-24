import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const baseEnv = {
  SQLITE_PATH: './data/virtual-ocpp.sqlite',
  SESSION_SECRET: 'a'.repeat(32),
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'correct-password'
};

describe('loadConfig', () => {
  it('loads the configured sqlite path and credentials', () => {
    const config = loadConfig(baseEnv);

    expect(config.port).toBe(8797);
    expect(config.host).toBe('0.0.0.0');
    expect(config.sqlitePath).toBe('./data/virtual-ocpp.sqlite');
    expect(config.adminUsername).toBe('admin');
    expect(config.adminPassword).toBe('correct-password');
    expect(config.chargerSilentAfterSeconds).toBe(300);
    expect(config.meterGapThresholdWh).toBe(1000);
  });

  it('accepts DB_PATH as an alias for SQLITE_PATH', () => {
    const config = loadConfig({
      ...baseEnv,
      SQLITE_PATH: undefined,
      DB_PATH: './data/virtual-ocpp.sqlite'
    });

    expect(config.sqlitePath).toBe('./data/virtual-ocpp.sqlite');
  });

  it('requires a session secret', () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        SESSION_SECRET: 'short'
      })
    ).toThrow(/SESSION_SECRET/);
  });

  it('requires a non-empty admin password without enforcing length', () => {
    const config = loadConfig({
      ...baseEnv,
      ADMIN_PASSWORD: 'x'
    });

    expect(config.adminPassword).toBe('x');
    expect(() =>
      loadConfig({
        ...baseEnv,
        ADMIN_PASSWORD: ''
      })
    ).toThrow(/ADMIN_PASSWORD/);
  });

  it('parses the configured charger silence threshold', () => {
    const config = loadConfig({
      ...baseEnv,
      CHARGER_SILENT_AFTER_SECONDS: '180'
    });

    expect(config.chargerSilentAfterSeconds).toBe(180);
  });

  it('parses the configured meter gap threshold', () => {
    const config = loadConfig({
      ...baseEnv,
      METER_GAP_THRESHOLD_WH: '2500'
    });

    expect(config.meterGapThresholdWh).toBe(2500);
  });

  it('treats blank optional OCPP values as unset', () => {
    const config = loadConfig({
      ...baseEnv,
      OCPP_BASIC_AUTH_PASSWORD: '',
      OCPP_PUBLIC_URL: ''
    });

    expect(config.ocppBasicAuthPassword).toBeUndefined();
    expect(config.ocppPublicUrl).toBeUndefined();
  });

  it('rejects placeholder production secrets', () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        NODE_ENV: 'production',
        SESSION_SECRET: 'replace-with-at-least-32-random-characters'
      })
    ).toThrow(/SESSION_SECRET must be replaced/);

    expect(() =>
      loadConfig({
        ...baseEnv,
        NODE_ENV: 'production',
        ADMIN_PASSWORD: 'replace-me'
      })
    ).toThrow(/ADMIN_PASSWORD must be replaced/);
  });
});
