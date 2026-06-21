import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from './db/client.js';
import { requireAdmin } from './auth.js';
import { formatSseEvent, type LiveUpdateBus } from './live-updates.js';

const HEARTBEAT_MS = 15_000;

export function registerLiveUpdateRoutes(app: FastifyInstance, db: Database, liveUpdates: LiveUpdateBus) {
  app.get('/api/live-updates', async (request, reply) => {
    if (await requireAdmin(request, reply, db)) return;

    const lastEventId = parseLastEventId(request);
    const unsubscribe = liveUpdates.subscribe((envelope) => {
      reply.raw.write(formatSseEvent(envelope));
    });

    reply.hijack();
    setSseHeaders(reply);
    reply.raw.write('event: ready\ndata: {"ok":true}\n\n');

    for (const envelope of liveUpdates.replaySince(lastEventId)) {
      reply.raw.write(formatSseEvent(envelope));
    }

    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(': keep-alive\n\n');
      }
    }, HEARTBEAT_MS);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    };

    request.raw.on('close', cleanup);
    request.raw.on('aborted', cleanup);
    reply.raw.on('close', cleanup);
  });
}

function setSseHeaders(reply: FastifyReply) {
  reply.raw.statusCode = 200;
  reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.setHeader('X-Accel-Buffering', 'no');
  reply.raw.flushHeaders?.();
}

function parseLastEventId(request: FastifyRequest) {
  const header = request.headers['last-event-id'];
  if (typeof header === 'string' && header.trim()) {
    return header.trim();
  }

  return null;
}
