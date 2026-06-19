CREATE TABLE IF NOT EXISTS `communication_journal` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `direction` text NOT NULL,
  `source_type` text NOT NULL,
  `source_id` text NOT NULL,
  `target_type` text NOT NULL,
  `target_id` text NOT NULL,
  `charger_id` text,
  `proxy_target_id` text,
  `message_type` text NOT NULL,
  `ocpp_method` text,
  `transaction_id` integer,
  `id_tag` text,
  `payload_json` text NOT NULL,
  `error_code` text,
  `error_description` text,
  `correlation_id` text
);

CREATE INDEX IF NOT EXISTS `communication_journal_created_at_idx` ON `communication_journal` (`created_at`);
CREATE INDEX IF NOT EXISTS `communication_journal_source_idx` ON `communication_journal` (`source_type`, `source_id`);
CREATE INDEX IF NOT EXISTS `communication_journal_target_idx` ON `communication_journal` (`target_type`, `target_id`);
CREATE INDEX IF NOT EXISTS `communication_journal_charger_id_idx` ON `communication_journal` (`charger_id`);
CREATE INDEX IF NOT EXISTS `communication_journal_proxy_target_id_idx` ON `communication_journal` (`proxy_target_id`);
CREATE INDEX IF NOT EXISTS `communication_journal_ocpp_method_idx` ON `communication_journal` (`ocpp_method`);
CREATE INDEX IF NOT EXISTS `communication_journal_message_type_idx` ON `communication_journal` (`message_type`);
