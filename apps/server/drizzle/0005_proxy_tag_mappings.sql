CREATE TABLE IF NOT EXISTS `proxy_tag_mappings` (
  `id` text PRIMARY KEY NOT NULL,
  `proxy_target_id` text NOT NULL,
  `local_id_tag` text NOT NULL,
  `outbound_id_tag` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `proxy_tag_mappings_proxy_target_id_idx`
  ON `proxy_tag_mappings` (`proxy_target_id`);

CREATE UNIQUE INDEX IF NOT EXISTS `proxy_tag_mappings_proxy_target_id_local_id_tag_unique`
  ON `proxy_tag_mappings` (`proxy_target_id`, `local_id_tag`);
