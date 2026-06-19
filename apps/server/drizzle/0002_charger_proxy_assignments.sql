CREATE TABLE IF NOT EXISTS `charger_proxy_assignments` (
  `id` text PRIMARY KEY NOT NULL,
  `charger_id` text NOT NULL,
  `proxy_target_id` text NOT NULL,
  `enabled` integer DEFAULT 1 NOT NULL,
  `station_id` text,
  `mode` text NOT NULL,
  `outage_policy` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `charger_proxy_assignments_charger_id_proxy_target_id_unique`
  ON `charger_proxy_assignments` (`charger_id`, `proxy_target_id`);

CREATE INDEX IF NOT EXISTS `charger_proxy_assignments_charger_id_idx`
  ON `charger_proxy_assignments` (`charger_id`);

CREATE INDEX IF NOT EXISTS `charger_proxy_assignments_proxy_target_id_idx`
  ON `charger_proxy_assignments` (`proxy_target_id`);
