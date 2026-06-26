import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import { apiTokens, sessions } from './db/schema.js';
import type { LiveUpdateBus } from './live-updates.js';
import { recordLogEntry } from './log-writer.js';

const SESSION_COOKIE = 'virtual_ocpp_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const ACCESS_TOKEN_VERSION = 'v1';

export type ApiAccessScope = 'read' | 'write';
export type ApiTokenScope = 'read_only' | 'read_write';

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

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply, db: Database, scope: ApiAccessScope = 'read') {
  return requireApiAccess(request, reply, db, scope);
}

export async function requireApiAccess(request: FastifyRequest, reply: FastifyReply, db: Database, scope: ApiAccessScope) {
  const bearer = parseBearerToken(request.headers.authorization);
  if (bearer) {
    const token = await getApiToken(bearer.tokenId, bearer.secret, db);
    if (!token) {
      reply.code(401).send({ error: 'unauthorized' });
      return true;
    }

    if (!scopeAllows(token.scope, scope)) {
      reply.code(403).send({ error: 'insufficient_scope' });
      return true;
    }

    return false;
  }

  const signed = request.unsignCookie(request.cookies[SESSION_COOKIE] ?? '');
  if (!signed.valid || !signed.value || !(await getSession(signed.value, db))) {
    reply.code(401).send({ error: 'unauthorized' });
    return true;
  }

  return false;
}

export async function requireAdminCookie(request: FastifyRequest, reply: FastifyReply, db: Database) {
  const signed = request.unsignCookie(request.cookies[SESSION_COOKIE] ?? '');
  if (!signed.valid || !signed.value || !(await getSession(signed.value, db))) {
    reply.code(401).send({ error: 'unauthorized' });
    return true;
  }

  return false;
}

export function createApiTokenMaterial(tokenId: string = randomUUID()) {
  const secret = randomBytes(24).toString('base64url');
  return {
    tokenId,
    secret,
    token: secret,
    tokenHash: hashTokenSecret(secret)
  };
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

async function getApiToken(tokenId: string | null, secret: string, db: Database) {
  const tokenHash = hashTokenSecret(secret);
  const rows = tokenId
    ? await db.select().from(apiTokens).where(eq(apiTokens.id, tokenId)).limit(1)
    : await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, tokenHash)).limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }

  const now = new Date();
  if (row.revokedAt || (row.expiresAt && row.expiresAt.getTime() <= now.getTime())) {
    return null;
  }

  if (!safeEquals(tokenHash, row.tokenHash)) {
    return null;
  }

  await db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, row.id)).run();
  return row;
}

function parseBearerToken(header: string | undefined) {
  const value = header?.trim();
  if (!value) {
    return null;
  }

  const [scheme, token] = value.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  const tokenParts = token.split('.');
  if (tokenParts.length === 3 && tokenParts[0] === ACCESS_TOKEN_VERSION && tokenParts[1] && tokenParts[2]) {
    return {
      tokenId: tokenParts[1],
      secret: tokenParts[2]
    };
  }

  return {
    tokenId: null,
    secret: token
  };
}

function scopeAllows(tokenScope: string, requiredScope: ApiAccessScope) {
  if (requiredScope === 'read') {
    return true;
  }

  return tokenScope === 'read_write';
}

function hashTokenSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
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
