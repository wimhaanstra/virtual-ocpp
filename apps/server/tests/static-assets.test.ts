import Fastify from 'fastify';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { registerStaticAssetRoutes } from '../src/static-assets.js';

describe('static assets', () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { force: true, recursive: true });
      tempDir = undefined;
    }
  });

  it('serves vite assets and falls back deep links to the SPA index', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'virtual-ocpp-web-dist-'));
    mkdirSync(join(tempDir, 'assets'));
    writeFileSync(join(tempDir, 'index.html'), '<html><body>Virtual OCPP</body></html>');
    writeFileSync(join(tempDir, 'assets', 'app.js'), 'console.log("ok");');
    const app = Fastify({ logger: false });
    registerStaticAssetRoutes(app, tempDir);

    const asset = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['content-type']).toContain('text/javascript');
    expect(asset.body).toBe('console.log("ok");');

    const deepLink = await app.inject({ method: 'GET', url: '/sessions?chargerId=SMART-EVSE-1' });
    expect(deepLink.statusCode).toBe(200);
    expect(deepLink.headers['content-type']).toContain('text/html');
    expect(deepLink.body).toContain('Virtual OCPP');

    const apiMiss = await app.inject({ method: 'GET', url: '/api/not-found' });
    expect(apiMiss.statusCode).toBe(404);
    expect(apiMiss.json()).toEqual({ error: 'not_found' });

    const assetMiss = await app.inject({ method: 'GET', url: '/assets/missing.js' });
    expect(assetMiss.statusCode).toBe(404);
    expect(assetMiss.json()).toEqual({ error: 'not_found' });

    const ocppMiss = await app.inject({ method: 'GET', url: '/ocpp' });
    expect(ocppMiss.statusCode).toBe(404);
    expect(ocppMiss.json()).toEqual({ error: 'not_found' });

    await app.close();
  });
});
