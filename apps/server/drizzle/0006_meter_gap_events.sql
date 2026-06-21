CREATE TABLE IF NOT EXISTS `meter_gap_events` (
  `id` text PRIMARY KEY NOT NULL,
  `charger_id` text NOT NULL,
  `connector_id` integer NOT NULL,
  `previous_session_id` text,
  `new_session_id` text NOT NULL,
  `previous_stopped_at` integer,
  `new_started_at` integer NOT NULL,
  `previous_meter_wh` integer NOT NULL,
  `new_meter_start_wh` integer NOT NULL,
  `delta_wh` integer NOT NULL,
  `threshold_wh` integer NOT NULL,
  `status` text NOT NULL,
  `submission_result_json` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `meter_gap_events_charger_id_idx`
  ON `meter_gap_events` (`charger_id`);

CREATE INDEX IF NOT EXISTS `meter_gap_events_status_idx`
  ON `meter_gap_events` (`status`);
