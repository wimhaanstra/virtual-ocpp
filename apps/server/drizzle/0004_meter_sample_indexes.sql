CREATE INDEX IF NOT EXISTS `meter_samples_session_idx`
  ON `meter_samples` (`charger_id`, `transaction_id`, `sampled_at`);

CREATE INDEX IF NOT EXISTS `meter_samples_measurand_idx`
  ON `meter_samples` (`measurand`);
