CREATE INDEX IF NOT EXISTS `communication_journal_created_at_id_idx`
  ON `communication_journal` (`created_at`, `id`);

CREATE INDEX IF NOT EXISTS `communication_journal_charger_created_at_idx`
  ON `communication_journal` (`charger_id`, `created_at`, `id`);

CREATE INDEX IF NOT EXISTS `communication_journal_proxy_target_created_at_idx`
  ON `communication_journal` (`proxy_target_id`, `created_at`, `id`);

CREATE INDEX IF NOT EXISTS `communication_journal_source_created_at_idx`
  ON `communication_journal` (`source_type`, `source_id`, `created_at`, `id`);

CREATE INDEX IF NOT EXISTS `communication_journal_target_created_at_idx`
  ON `communication_journal` (`target_type`, `target_id`, `created_at`, `id`);

CREATE INDEX IF NOT EXISTS `communication_journal_message_type_created_at_idx`
  ON `communication_journal` (`message_type`, `created_at`, `id`);

CREATE INDEX IF NOT EXISTS `communication_journal_transaction_created_at_idx`
  ON `communication_journal` (`transaction_id`, `created_at`, `id`);
