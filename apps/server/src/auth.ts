import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import { sessions } from './db/schema.js';
import type { LiveUpdateBus } from './live-updates.js';
import { recordLogEntry } from './log-writer.js';

const SESSION_COOKIE = 'virtual_ocpp_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

type LoginBody = {
  username?: string;
  password?: string;
};

export function registerAuthRoutes(app: FastifyInstance, config: AppConfig, db: Database, liveUpdates?: LiveUpdateBus) {
  app.post<{ Body: LoginBody }>('/api/auth/login', async (request, reply) => {
    const username = request.body?.username ?? '';
    const password = request.body?.password ?? '';

    if (!safeEquals(username, config.adminUsername) || !safeEquals(password, config.adminPassword)) {
      recordLogEntry(db, liveUpdates, {
        level: 'warn',
        category: 'auth',
        message: 'admin login failed'
      });

      return reply.code(401).send({ error: 'invalid_credentials' });
    }

    const sessionId = randomUUID();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_MS);

    await db.insert(sessions).values({
      id: sessionId,
      username: config.adminUsername,
      createdAt,
      expiresAt
    });

    reply.setCookie(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecureRequest(request),
      path: '/',
      signed: true,
      maxAge: SESSION_TTL_MS / 1000
    });

    return reply.send({
      ok: true,
      username: config.adminUsername
    });
  });

  const sessionHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const signed = request.unsignCookie(request.cookies[SESSION_COOKIE] ?? '');
    if (!signed.valid || !signed.value) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const session = await getSession(signed.value, db);
    if (!session) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    return {
      authenticated: true,
      username: session.username,
      expiresAt: session.expiresAt
    };
  };

  app.get('/api/auth/session', sessionHandler);
  app.get('/api/auth/me', sessionHandler);

  app.post('/api/auth/logout', async (request, reply) => {
    const signed = request.unsignCookie(request.cookies[SESSION_COOKIE] ?? '');

    if (signed.valid && signed.value) {
      await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, signed.value));
    }

    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.send({ ok: true });
  });
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply, db: Database) {
  const signed = request.unsignCookie(request.cookies[SESSION_COOKIE] ?? '');
  if (!signed.valid || !signed.value || !(await getSession(signed.value, db))) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
}

export function verifyAdminPassword(config: Pick<AppConfig, 'adminPassword'>, password: string) {
  return safeEquals(password, config.adminPassword);
}

async function getSession(sessionId: string, db: Database) {
  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return rows[0] ?? null;
}

function safeEquals(left: string, right: string) {
  const leftHash = hash(left);
  const rightHash = hash(right);
  return timingSafeEqual(leftHash, rightHash);
}

function hash(value: string) {
  return createHash('sha256').update(value).digest();
}

function isSecureRequest(request: FastifyRequest) {
  const forwardedProto = request.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  if (proto) {
    return proto.split(',')[0]?.trim().toLowerCase() === 'https';
  }

  return request.protocol === 'https';
}
