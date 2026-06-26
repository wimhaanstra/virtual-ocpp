import { createHash, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import { apiTokens, DEFAULT_TENANT_ID, sessions, tenantInvites, tenantMemberships, tenants, users } from './db/schema.js';
import type { LiveUpdateBus } from './live-updates.js';
import { recordLogEntry } from './log-writer.js';

const SESSION_COOKIE = 'virtual_ocpp_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const ACCESS_TOKEN_VERSION = 'v1';
const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const PASSWORD_HASH_ITERATIONS = 120_000;

export type ApiAccessScope = 'read' | 'write';
export type ApiTokenScope = 'read_only' | 'read_write';
export type TenantRole = 'owner' | 'admin' | 'viewer';

export type TenantAuthContext = {
  tenantId: string;
  userId: string | null;
  username: string;
  role: TenantRole;
  isSuperAdmin: boolean;
  tokenId?: string;
  scope: ApiTokenScope | 'session';
};

type LoginBody = {
  username?: string;
  password?: string;
};

type RegisterBody = {
  username?: string;
  password?: string;
};

type CreateInviteBody = {
  role?: TenantRole;
};

type AcceptInviteBody = {
  code?: string;
  username?: string;
  password?: string;
};

type SelectAccountBody = {
  tenantId?: string;
};

type UpdateAccountBody = {
  name?: string;
};

type UpdateMembershipBody = {
  role?: TenantRole;
};

const requestContexts = new WeakMap<FastifyRequest, TenantAuthContext>();

export function registerAuthRoutes(app: FastifyInstance, config: AppConfig, db: Database, liveUpdates?: LiveUpdateBus) {
  app.post<{ Body: LoginBody }>('/api/auth/login', async (request, reply) => {
    const username = request.body?.username ?? '';
    const password = request.body?.password ?? '';

    await bootstrapConfiguredAdminIfNeeded(db, config, username, password);
    const user = await authenticateUser(db, username, password);
    if (!user) {
      recordLogEntry(db, liveUpdates, {
        level: 'warn',
        tenantId: DEFAULT_TENANT_ID,
        category: 'auth',
        message: 'login failed'
      });

      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    promoteConfiguredSuperAdminIfNeeded(db, config, user, username, password);

    const membership = getPrimaryMembership(db, user.id);
    if (!membership) {
      return reply.code(403).send({ error: 'membership_required' });
    }

    const sessionId = randomUUID();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_MS);

    await db.insert(sessions).values({
      id: sessionId,
      tenantId: membership.tenantId,
      userId: user.id,
      role: membership.role,
      username: user.username,
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
      ...serializeAuthContext({
        tenantId: membership.tenantId,
        userId: user.id,
        username: user.username,
        role: membership.role as TenantRole,
        isSuperAdmin: Boolean(user.isSuperAdmin) || isConfiguredAdminLogin(config, username, password),
        scope: 'session'
      })
    });
  });

  app.post<{ Body: RegisterBody }>('/api/auth/register', async (request, reply) => {
    const username = request.body?.username?.trim() ?? '';
    const password = request.body?.password ?? '';
    if (!username || password.length < 8) {
      return reply.code(400).send({ error: 'invalid_registration' });
    }

    const now = new Date();
    const tenantId = randomUUID();
    const userId = randomUUID();
    const tenantName = createGeneratedTenantName();
    try {
      db.transaction((tx) => {
        tx.insert(tenants).values({
          id: tenantId,
          publicId: createPublicId(tenantName),
          name: tenantName,
          createdAt: now,
          updatedAt: now
        }).run();
        tx.insert(users).values({
          id: userId,
          username,
          passwordHash: hashPassword(password),
          createdAt: now,
          updatedAt: now
        }).run();
        tx.insert(tenantMemberships).values({
          id: randomUUID(),
          tenantId,
          userId,
          role: 'owner',
          createdAt: now,
          updatedAt: now
        }).run();
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        return reply.code(409).send({ error: 'registration_conflict' });
      }
      throw error;
    }

    return createSessionReply(reply, request, db, {
      tenantId,
      userId,
      username,
      role: 'owner',
      isSuperAdmin: false,
      scope: 'session'
    });
  });

  app.post<{ Body: CreateInviteBody }>('/api/auth/invites', async (request, reply) => {
    const auth = await requireTenantRole(request, reply, db, 'owner');
    if (!auth) return;
    const role = request.body?.role ?? 'viewer';
    if (!['owner', 'admin', 'viewer'].includes(role)) {
      return reply.code(400).send({ error: 'invalid_invite_role' });
    }

    const code = randomBytes(24).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
    db.insert(tenantInvites).values({
      id: randomUUID(),
      tenantId: auth.tenantId,
      codeHash: hashTokenSecret(code),
      role,
      createdByUserId: auth.userId ?? '',
      createdAt: now,
      expiresAt
    }).run();

    return reply.code(201).send({ code, role, expiresAt: expiresAt.toISOString() });
  });

  app.get('/api/auth/invites', async (request, reply) => {
    const auth = await requireTenantRole(request, reply, db, 'owner');
    if (!auth) return;

    const now = new Date();
    return db
      .select()
      .from(tenantInvites)
      .where(and(eq(tenantInvites.tenantId, auth.tenantId), isNull(tenantInvites.redeemedAt), isNull(tenantInvites.revokedAt), gt(tenantInvites.expiresAt, now)))
      .all()
      .map((invite) => ({
        id: invite.id,
        role: invite.role,
        createdByUserId: invite.createdByUserId,
        createdAt: invite.createdAt.toISOString(),
        expiresAt: invite.expiresAt.toISOString()
      }));
  });

  app.post<{ Params: { inviteId: string } }>('/api/auth/invites/:inviteId/revoke', async (request, reply) => {
    const auth = await requireTenantRole(request, reply, db, 'owner');
    if (!auth) return;

    const invite = db
      .select()
      .from(tenantInvites)
      .where(and(eq(tenantInvites.id, request.params.inviteId), eq(tenantInvites.tenantId, auth.tenantId), isNull(tenantInvites.redeemedAt), isNull(tenantInvites.revokedAt)))
      .limit(1)
      .get();
    if (!invite) {
      return reply.code(404).send({ error: 'invite_not_found' });
    }

    db.update(tenantInvites).set({ revokedAt: new Date() }).where(eq(tenantInvites.id, invite.id)).run();
    return { ok: true, id: invite.id };
  });

  app.get<{ Params: { code: string } }>('/api/auth/invites/:code', async (request, reply) => {
    const invite = getValidInvite(db, request.params.code);
    if (!invite) {
      return reply.code(404).send({ error: 'invite_not_found' });
    }

    const tenant = db.select().from(tenants).where(eq(tenants.id, invite.tenantId)).limit(1).get();
    if (!tenant) {
      return reply.code(404).send({ error: 'invite_not_found' });
    }

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      role: invite.role,
      expiresAt: invite.expiresAt.toISOString()
    };
  });

  app.post<{ Body: AcceptInviteBody }>('/api/auth/invites/accept', async (request, reply) => {
    const code = request.body?.code ?? '';
    const username = request.body?.username?.trim() ?? '';
    const password = request.body?.password ?? '';
    if (!code || !username || password.length < 8) {
      return reply.code(400).send({ error: 'invalid_invite_acceptance' });
    }

    const invite = getValidInvite(db, code);
    if (!invite) {
      return reply.code(404).send({ error: 'invite_not_found' });
    }

    const now = new Date();
    const existingUser = db.select().from(users).where(eq(users.username, username)).limit(1).get();
    if (existingUser && !verifyPassword(password, existingUser.passwordHash)) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    const userId = existingUser?.id ?? randomUUID();
    try {
      db.transaction((tx) => {
        if (!existingUser) {
          tx.insert(users).values({
            id: userId,
            username,
            passwordHash: hashPassword(password),
            createdAt: now,
            updatedAt: now
          }).run();
        }
        tx.insert(tenantMemberships).values({
          id: randomUUID(),
          tenantId: invite.tenantId,
          userId,
          role: invite.role,
          createdAt: now,
          updatedAt: now
        }).run();
        tx.update(tenantInvites).set({ redeemedAt: now, redeemedByUserId: userId }).where(eq(tenantInvites.id, invite.id)).run();
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        return reply.code(409).send({ error: 'invite_user_conflict' });
      }
      throw error;
    }

    return createSessionReply(reply, request, db, {
      tenantId: invite.tenantId,
      userId,
      username,
      role: invite.role as TenantRole,
      isSuperAdmin: Boolean(existingUser?.isSuperAdmin),
      scope: 'session'
    });
  });

  app.post<{ Body: { code?: string } }>('/api/auth/invites/redeem', async (request, reply) => {
    const auth = await requireTenantRole(request, reply, db, 'viewer');
    if (!auth?.userId) return;

    const code = request.body?.code ?? '';
    const invite = getValidInvite(db, code);
    if (!invite) {
      return reply.code(404).send({ error: 'invite_not_found' });
    }

    const existingMembership = db
      .select()
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, invite.tenantId), eq(tenantMemberships.userId, auth.userId), isNull(tenantMemberships.revokedAt)))
      .limit(1)
      .get();
    if (existingMembership) {
      return reply.code(409).send({ error: 'already_member' });
    }

    const now = new Date();
    db.transaction((tx) => {
      tx.insert(tenantMemberships).values({
        id: randomUUID(),
        tenantId: invite.tenantId,
        userId: auth.userId!,
        role: invite.role,
        createdAt: now,
        updatedAt: now
      }).run();
      tx.update(tenantInvites).set({ redeemedAt: now, redeemedByUserId: auth.userId }).where(eq(tenantInvites.id, invite.id)).run();
      tx.update(sessions).set({ tenantId: invite.tenantId, role: invite.role }).where(eq(sessions.id, getSignedSessionId(request) ?? '')).run();
    });

    const tenant = db.select().from(tenants).where(eq(tenants.id, invite.tenantId)).limit(1).get();
    return { ok: true, tenantId: invite.tenantId, tenantName: tenant?.name ?? invite.tenantId, role: invite.role };
  });

  app.post<{ Body: SelectAccountBody }>('/api/auth/accounts/select', async (request, reply) => {
    const auth = await requireTenantRole(request, reply, db, 'viewer');
    if (!auth?.userId) return;

    const tenantId = request.body?.tenantId ?? '';
    const membership = db
      .select()
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, auth.userId), isNull(tenantMemberships.revokedAt)))
      .limit(1)
      .get();
    if (!membership && auth.isSuperAdmin) {
      const tenant = db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1).get();
      if (!tenant) {
        return reply.code(404).send({ error: 'account_not_found' });
      }
      db.update(sessions).set({ tenantId: tenant.id, role: 'owner' }).where(eq(sessions.id, getSignedSessionId(request) ?? '')).run();
      return { ok: true, tenantId: tenant.id, role: 'owner' };
    }
    if (!membership) {
      return reply.code(404).send({ error: 'account_not_found' });
    }

    db.update(sessions).set({ tenantId: membership.tenantId, role: membership.role }).where(eq(sessions.id, getSignedSessionId(request) ?? '')).run();
    return { ok: true, tenantId: membership.tenantId, role: membership.role };
  });

  app.patch<{ Params: { tenantId: string }; Body: UpdateAccountBody }>('/api/auth/accounts/:tenantId', async (request, reply) => {
    const auth = await requireTenantRole(request, reply, db, 'owner');
    if (!auth) return;
    if (auth.tenantId !== request.params.tenantId && !auth.isSuperAdmin) {
      return reply.code(403).send({ error: 'insufficient_role' });
    }

    const name = request.body?.name?.trim() ?? '';
    if (name.length < 1 || name.length > 80) {
      return reply.code(400).send({ error: 'invalid_account_name' });
    }

    const tenant = db.select().from(tenants).where(eq(tenants.id, request.params.tenantId)).limit(1).get();
    if (!tenant) {
      return reply.code(404).send({ error: 'account_not_found' });
    }

    db.update(tenants).set({ name, updatedAt: new Date() }).where(eq(tenants.id, tenant.id)).run();
    return { ok: true, tenantId: tenant.id, tenantName: name };
  });

  app.get('/api/auth/account-members', async (request, reply) => {
    const auth = await requireTenantRole(request, reply, db, 'owner');
    if (!auth) return;

    return getTenantMembers(db, auth.tenantId);
  });

  app.patch<{ Params: { membershipId: string }; Body: UpdateMembershipBody }>('/api/auth/account-members/:membershipId', async (request, reply) => {
    const auth = await requireTenantRole(request, reply, db, 'owner');
    if (!auth) return;

    const role = request.body?.role;
    if (!role || !['owner', 'admin', 'viewer'].includes(role)) {
      return reply.code(400).send({ error: 'invalid_membership_role' });
    }

    const membership = db
      .select()
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.id, request.params.membershipId), eq(tenantMemberships.tenantId, auth.tenantId), isNull(tenantMemberships.revokedAt)))
      .limit(1)
      .get();
    if (!membership) {
      return reply.code(404).send({ error: 'membership_not_found' });
    }
    if (membership.userId === auth.userId) {
      return reply.code(409).send({ error: 'current_member_locked' });
    }
    if (membership.role === 'owner' && role !== 'owner' && countActiveTenantOwners(db, auth.tenantId) <= 1) {
      return reply.code(409).send({ error: 'last_owner_required' });
    }

    db.update(tenantMemberships).set({ role, updatedAt: new Date() }).where(eq(tenantMemberships.id, membership.id)).run();
    db.update(sessions).set({ role }).where(and(eq(sessions.tenantId, auth.tenantId), eq(sessions.userId, membership.userId), isNull(sessions.revokedAt))).run();
    return getTenantMembers(db, auth.tenantId).find((entry) => entry.id === membership.id);
  });

  app.post<{ Params: { membershipId: string } }>('/api/auth/account-members/:membershipId/remove', async (request, reply) => {
    const auth = await requireTenantRole(request, reply, db, 'owner');
    if (!auth) return;

    const membership = db
      .select()
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.id, request.params.membershipId), eq(tenantMemberships.tenantId, auth.tenantId), isNull(tenantMemberships.revokedAt)))
      .limit(1)
      .get();
    if (!membership) {
      return reply.code(404).send({ error: 'membership_not_found' });
    }
    if (membership.userId === auth.userId) {
      return reply.code(409).send({ error: 'current_member_locked' });
    }
    if (membership.role === 'owner' && countActiveTenantOwners(db, auth.tenantId) <= 1) {
      return reply.code(409).send({ error: 'last_owner_required' });
    }

    const now = new Date();
    db.update(tenantMemberships).set({ revokedAt: now, updatedAt: now }).where(eq(tenantMemberships.id, membership.id)).run();
    db.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.tenantId, auth.tenantId), eq(sessions.userId, membership.userId), isNull(sessions.revokedAt))).run();
    return { ok: true, id: membership.id };
  });

  const sessionHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await resolveCookieAuth(request, db);
    if (!auth) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    return {
      authenticated: true,
      ...serializeAuthContext(auth),
      memberships: auth.userId ? getMembershipSummaries(db, auth.userId, auth.isSuperAdmin) : [],
      expiresAt: getSessionExpiry(request, db)?.toISOString() ?? null
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
  const role = scope === 'read' ? 'viewer' : 'admin';
  return !(await requireTenantRole(request, reply, db, role));
}

export async function requireApiAccess(request: FastifyRequest, reply: FastifyReply, db: Database, scope: ApiAccessScope) {
  const auth = await resolveApiAccess(request, db);
  if (!auth) {
    reply.code(401).send({ error: 'unauthorized' });
    return true;
  }
  if (scope === 'write' && auth.scope === 'read_only') {
    reply.code(403).send({ error: 'insufficient_scope' });
    return true;
  }
  requestContexts.set(request, auth);
  return false;
}

export async function requireAdminCookie(request: FastifyRequest, reply: FastifyReply, db: Database) {
  const auth = await resolveCookieAuth(request, db);
  if (!auth) {
    reply.code(401).send({ error: 'unauthorized' });
    return true;
  }
  requestContexts.set(request, auth);
  return false;
}

export async function requireTenantRole(request: FastifyRequest, reply: FastifyReply, db: Database, role: TenantRole) {
  const auth = await resolveApiAccess(request, db);
  if (!auth) {
    reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  if (auth.scope === 'read_only' && role !== 'viewer') {
    reply.code(403).send({ error: 'insufficient_scope' });
    return null;
  }
  if (!roleAllows(auth.role, role)) {
    reply.code(403).send({ error: 'insufficient_role' });
    return null;
  }
  requestContexts.set(request, auth);
  return auth;
}

export function getTenantAuthContext(request: FastifyRequest) {
  return requestContexts.get(request) ?? null;
}

export function getTenantId(request: FastifyRequest) {
  return getTenantAuthContext(request)?.tenantId ?? DEFAULT_TENANT_ID;
}

async function resolveApiAccess(request: FastifyRequest, db: Database) {
  const bearer = parseBearerToken(request.headers.authorization);
  if (bearer) {
    const token = await getApiToken(bearer.tokenId, bearer.secret, db);
    if (!token) return null;
    return {
      tenantId: token.tenantId,
      userId: token.userId,
      username: 'api-token',
      role: 'admin' as TenantRole,
      isSuperAdmin: false,
      tokenId: token.id,
      scope: token.scope as ApiTokenScope
    };
  }

  return resolveCookieAuth(request, db);
}

async function resolveCookieAuth(request: FastifyRequest, db: Database) {
  const signed = request.unsignCookie(request.cookies[SESSION_COOKIE] ?? '');
  if (!signed.valid || !signed.value) return null;
  const session = await getSession(signed.value, db);
  if (!session) return null;

  const user = session.userId ? db.select().from(users).where(eq(users.id, session.userId)).limit(1).get() : null;
  return {
    tenantId: session.tenantId,
    userId: session.userId,
    username: session.username,
    role: session.role as TenantRole,
    isSuperAdmin: Boolean(user?.isSuperAdmin),
    scope: 'session' as const
  };
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

function getSessionExpiry(request: FastifyRequest, db: Database) {
  const sessionId = getSignedSessionId(request);
  if (!sessionId) return null;
  return db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1).get()?.expiresAt ?? null;
}

async function authenticateUser(db: Database, username: string, password: string) {
  const row = db.select().from(users).where(eq(users.username, username)).limit(1).get();
  if (!row || row.disabledAt) return null;
  if (!verifyPassword(password, row.passwordHash)) return null;
  return row;
}

function getPrimaryMembership(db: Database, userId: string) {
  return db.select().from(tenantMemberships).where(and(eq(tenantMemberships.userId, userId), isNull(tenantMemberships.revokedAt))).limit(1).get();
}

function getValidInvite(db: Database, code: string) {
  if (!code) return null;
  return db
    .select()
    .from(tenantInvites)
    .where(and(eq(tenantInvites.codeHash, hashTokenSecret(code)), isNull(tenantInvites.redeemedAt), isNull(tenantInvites.revokedAt), gt(tenantInvites.expiresAt, new Date())))
    .limit(1)
    .get() ?? null;
}

function getSignedSessionId(request: FastifyRequest) {
  const signed = request.unsignCookie(request.cookies[SESSION_COOKIE] ?? '');
  return signed.valid && signed.value ? signed.value : null;
}

function getMembershipSummaries(db: Database, userId: string, isSuperAdmin: boolean) {
  if (isSuperAdmin) {
    return db.select().from(tenants).all().map((tenant) => ({
      tenantId: tenant.id,
      tenantName: tenant.name,
      role: 'owner' as const
    }));
  }

  const memberships = db.select().from(tenantMemberships).where(and(eq(tenantMemberships.userId, userId), isNull(tenantMemberships.revokedAt))).all();
  return memberships.map((membership) => {
    const tenant = db.select().from(tenants).where(eq(tenants.id, membership.tenantId)).limit(1).get();
    return {
      tenantId: membership.tenantId,
      tenantName: tenant?.name ?? membership.tenantId,
      role: membership.role
    };
  });
}

function getTenantMembers(db: Database, tenantId: string) {
  return db
    .select()
    .from(tenantMemberships)
    .where(and(eq(tenantMemberships.tenantId, tenantId), isNull(tenantMemberships.revokedAt)))
    .all()
    .map((membership) => {
      const user = db.select().from(users).where(eq(users.id, membership.userId)).limit(1).get();
      return {
        id: membership.id,
        userId: membership.userId,
        username: user?.username ?? 'Unknown user',
        role: membership.role,
        createdAt: membership.createdAt.toISOString(),
        updatedAt: membership.updatedAt.toISOString()
      };
    });
}

function countActiveTenantOwners(db: Database, tenantId: string) {
  return db
    .select()
    .from(tenantMemberships)
    .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.role, 'owner'), isNull(tenantMemberships.revokedAt)))
    .all().length;
}

async function bootstrapConfiguredAdminIfNeeded(db: Database, config: AppConfig, username: string, password: string) {
  const existingUser = db.select({ id: users.id }).from(users).limit(1).get();
  if (existingUser) return;
  if (!isConfiguredAdminLogin(config, username, password)) return;

  const now = new Date();
  const userId = randomUUID();
  db.transaction((tx) => {
    tx.insert(tenants).values({
      id: DEFAULT_TENANT_ID,
      publicId: DEFAULT_TENANT_ID,
      name: 'Default account',
      createdAt: now,
      updatedAt: now
    }).onConflictDoNothing().run();
    tx.insert(users).values({
      id: userId,
      username: config.adminUsername,
      passwordHash: hashPassword(config.adminPassword),
      isSuperAdmin: true,
      createdAt: now,
      updatedAt: now
    }).run();
    tx.insert(tenantMemberships).values({
      id: randomUUID(),
      tenantId: DEFAULT_TENANT_ID,
      userId,
      role: 'owner',
      createdAt: now,
      updatedAt: now
    }).run();
  });
}

function promoteConfiguredSuperAdminIfNeeded(
  db: Database,
  config: AppConfig,
  user: { id: string; isSuperAdmin: boolean },
  username: string,
  password: string
) {
  if (user.isSuperAdmin || !isConfiguredAdminLogin(config, username, password)) return;
  db.update(users).set({ isSuperAdmin: true, updatedAt: new Date() }).where(eq(users.id, user.id)).run();
}

function isConfiguredAdminLogin(config: AppConfig, username: string, password: string) {
  return safeEquals(username, config.adminUsername) && safeEquals(password, config.adminPassword);
}

async function createSessionReply(
  reply: FastifyReply,
  request: FastifyRequest,
  db: Database,
  auth: Omit<TenantAuthContext, 'tokenId'>
) {
  const sessionId = randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    id: sessionId,
    tenantId: auth.tenantId,
    userId: auth.userId,
    role: auth.role,
    username: auth.username,
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

  return reply.send({ ok: true, ...serializeAuthContext(auth), expiresAt: expiresAt.toISOString() });
}

function serializeAuthContext(auth: TenantAuthContext | Omit<TenantAuthContext, 'tokenId'>) {
  return {
    tenantId: auth.tenantId,
    userId: auth.userId,
    username: auth.username,
    role: auth.role,
    isSuperAdmin: auth.isSuperAdmin,
    scope: auth.scope
  };
}

function roleAllows(actual: TenantRole, required: TenantRole) {
  const rank: Record<TenantRole, number> = { viewer: 0, admin: 1, owner: 2 };
  return rank[actual] >= rank[required];
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

function hashTokenSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('base64url');
  const digest = pbkdf2Sync(password, salt, PASSWORD_HASH_ITERATIONS, 32, 'sha256').toString('base64url');
  return `pbkdf2_sha256$${PASSWORD_HASH_ITERATIONS}$${salt}$${digest}`;
}

function verifyPassword(password: string, stored: string) {
  const [algorithm, iterationsRaw, salt, digest] = stored.split('$');
  if (algorithm !== 'pbkdf2_sha256' || !iterationsRaw || !salt || !digest) return false;
  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  const candidate = pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64url');
  return safeEquals(candidate, digest);
}

function safeEquals(left: string, right: string) {
  const leftHash = hash(left);
  const rightHash = hash(right);
  return timingSafeEqual(leftHash, rightHash);
}

function hash(value: string) {
  return createHash('sha256').update(value).digest();
}

function createPublicId(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'tenant'}-${randomBytes(5).toString('base64url').toLowerCase()}`;
}

function createGeneratedTenantName() {
  return `Account ${randomBytes(3).toString('hex').toUpperCase()}`;
}

function isSecureRequest(request: FastifyRequest) {
  const forwardedProto = request.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  if (proto) {
    return proto.split(',')[0]?.trim().toLowerCase() === 'https';
  }

  return request.protocol === 'https';
}
