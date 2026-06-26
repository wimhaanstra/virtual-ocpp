CREATE TABLE IF NOT EXISTS api_tokens (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('read_only', 'read_write')),
  token_hash text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  expires_at integer,
  revoked_at integer,
  last_used_at integer
);

CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_token_hash_unique ON api_tokens (token_hash);
CREATE INDEX IF NOT EXISTS api_tokens_created_at_idx ON api_tokens (created_at);
