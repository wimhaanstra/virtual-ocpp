import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

const defaultStaticRoot = fileURLToPath(new URL('../../web/dist', import.meta.url));
const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

export function registerStaticAssetRoutes(app: FastifyInstance, staticRoot = process.env.WEB_DIST_PATH ?? defaultStaticRoot) {
  const root = resolve(staticRoot);
  const indexPath = resolve(root, 'index.html');

  if (!existsSync(indexPath)) {
    app.log.warn({ staticRoot: root }, 'web dist directory not found; production static assets disabled');
    return;
  }

  app.get('/*', async (request, reply) => {
    const requestPath = request.url.split('?')[0] ?? '/';
    if (isReservedBackendPath(requestPath)) {
      return reply.code(404).send({ error: 'not_found' });
    }

    const assetPath = resolveAssetPath(root, requestPath) ?? indexPath;
    if (!fileExists(assetPath) && extname(requestPath)) {
      return reply.code(404).send({ error: 'not_found' });
    }

    const filePath = fileExists(assetPath) ? assetPath : indexPath;
    reply.type(mimeTypes[extname(filePath)] ?? 'application/octet-stream');
    return reply.send(createReadStream(filePath));
  });
}

function resolveAssetPath(root: string, requestPath: string) {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  const normalizedPath = decodedPath === '/' ? '/index.html' : decodedPath;
  const filePath = resolve(root, `.${normalizedPath}`);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    return null;
  }

  return filePath;
}

function fileExists(path: string) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isReservedBackendPath(path: string) {
  return path === '/health' || path.startsWith('/api/') || path === '/api' || path === '/ocpp' || path.startsWith('/ocpp/');
}
