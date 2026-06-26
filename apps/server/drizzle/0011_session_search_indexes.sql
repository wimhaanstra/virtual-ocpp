CREATE INDEX IF NOT EXISTS charging_sessions_started_at_id_idx ON charging_sessions (started_at, id);
CREATE INDEX IF NOT EXISTS charging_sessions_charger_started_at_id_idx ON charging_sessions (charger_id, started_at, id);
CREATE INDEX IF NOT EXISTS charging_sessions_status_started_at_id_idx ON charging_sessions (status, started_at, id);
CREATE INDEX IF NOT EXISTS charging_sessions_transaction_id_idx ON charging_sessions (transaction_id);
CREATE INDEX IF NOT EXISTS charging_sessions_id_tag_idx ON charging_sessions (id_tag);
