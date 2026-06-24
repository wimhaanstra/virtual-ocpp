CREATE TABLE IF NOT EXISTS `remote_stop_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `charger_id` text NOT NULL,
  `transaction_id` integer NOT NULL,
  `status` text NOT NULL,
  `response_status` text,
  `error_code` text,
  `requested_at` integer NOT NULL,
  `completed_at` integer
);

CREATE INDEX IF NOT EXISTS `remote_stop_requests_session_id_idx` ON `remote_stop_requests` (`session_id`);
CREATE INDEX IF NOT EXISTS `remote_stop_requests_charger_transaction_idx` ON `remote_stop_requests` (`charger_id`, `transaction_id`);
CREATE INDEX IF NOT EXISTS `remote_stop_requests_status_idx` ON `remote_stop_requests` (`status`);
