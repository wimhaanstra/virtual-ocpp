import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/client.js';

describe('createDatabase', () => {
  it('reports the resolved sqlite path when the database cannot be opened', () => {
    const sqlitePath = join(tmpdir(), `virtual-ocpp-db-error-${randomUUID()}`);
    mkdirSync(sqlitePath, { recursive: true });

    expect(() => createDatabase({ sqlitePath })).toThrow(`SQLite database path is not writable or cannot be opened: ${sqlitePath}`);
  });
});
