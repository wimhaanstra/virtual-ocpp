CREATE TABLE IF NOT EXISTS `chargers` (
  `id` text PRIMARY KEY NOT NULL,
  `label` text,
  `enabled` integer DEFAULT 1 NOT NULL,
  `first_seen_at` integer NOT NULL,
  `last_seen_at` integer NOT NULL,
  `last_boot_at` integer,
  `charge_point_vendor` text,
  `charge_point_model` text,
  `firmware_version` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE TABLE IF NOT EXISTS `tag_charger_access` (
  `id` text PRIMARY KEY NOT NULL,
  `tag_id` text NOT NULL,
  `charger_id` text NOT NULL,
  `enabled` integer DEFAULT 1 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `tag_charger_access_tag_id_charger_id_unique`
  ON `tag_charger_access` (`tag_id`, `charger_id`);

CREATE INDEX IF NOT EXISTS `tag_charger_access_tag_id_idx`
  ON `tag_charger_access` (`tag_id`);

CREATE INDEX IF NOT EXISTS `tag_charger_access_charger_id_idx`
  ON `tag_charger_access` (`charger_id`);
