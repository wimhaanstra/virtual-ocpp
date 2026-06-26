CREATE TABLE IF NOT EXISTS tenants (
  id text PRIMARY KEY NOT NULL,
  public_id text NOT NULL,
  name text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS tenants_public_id_unique ON tenants (public_id);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY NOT NULL,
  username text NOT NULL,
  password_hash text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  disabled_at integer
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (username);

CREATE TABLE IF NOT EXISTS tenant_memberships (
  id text PRIMARY KEY NOT NULL,
  tenant_id text NOT NULL,
  user_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'viewer')),
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  revoked_at integer
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_memberships_tenant_user_unique ON tenant_memberships (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS tenant_memberships_user_id_idx ON tenant_memberships (user_id);
CREATE INDEX IF NOT EXISTS tenant_memberships_tenant_id_idx ON tenant_memberships (tenant_id);

CREATE TABLE IF NOT EXISTS tenant_invites (
  id text PRIMARY KEY NOT NULL,
  tenant_id text NOT NULL,
  code_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'viewer')),
  created_by_user_id text NOT NULL,
  created_at integer NOT NULL,
  expires_at integer NOT NULL,
  redeemed_at integer,
  redeemed_by_user_id text,
  revoked_at integer
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_invites_code_hash_unique ON tenant_invites (code_hash);
CREATE INDEX IF NOT EXISTS tenant_invites_tenant_id_idx ON tenant_invites (tenant_id);

CREATE TABLE IF NOT EXISTS charger_pairing_sessions (
  id text PRIMARY KEY NOT NULL,
  tenant_id text NOT NULL,
  pairing_code_hash text NOT NULL,
  basic_auth_username text,
  basic_auth_password_hash text,
  charger_id text,
  created_by_user_id text NOT NULL,
  created_at integer NOT NULL,
  expires_at integer NOT NULL,
  consumed_at integer
);

CREATE UNIQUE INDEX IF NOT EXISTS charger_pairing_sessions_code_hash_unique ON charger_pairing_sessions (pairing_code_hash);
CREATE INDEX IF NOT EXISTS charger_pairing_sessions_tenant_id_idx ON charger_pairing_sessions (tenant_id);

INSERT OR IGNORE INTO tenants (id, public_id, name, created_at, updated_at)
VALUES ('default', 'default', 'Default account', unixepoch('subsec') * 1000, unixepoch('subsec') * 1000);
