import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const baseEnv = {
  SQLITE_PATH: './data/virtual-ocpp.sqlite',
  SESSION_SECRET: 'a'.repeat(32),
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'correct-password'
};

describe('loadConfig', () => {
  it('loads the configured sqlite path and credentials', () => {
    const config = loadConfig(baseEnv);

    expect(config.port).toBe(3000);
    expect(config.host).toBe('0.0.0.0');
    expect(config.sqlitePath).toBe('./data/virtual-ocpp.sqlite');
    expect(config.adminUsername).toBe('admin');
    expect(config.adminPassword).toBe('correct-password');
    expect(config.communicationLogRetentionHours).toBe(24);
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

  it('parses the configured communication log retention hours', () => {
    const config = loadConfig({
      ...baseEnv,
      COMMUNICATION_LOG_RETENTION_HOURS: '72'
    });

    expect(config.communicationLogRetentionHours).toBe(72);
  });
});
