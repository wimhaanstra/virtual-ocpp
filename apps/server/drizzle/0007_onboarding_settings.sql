CREATE TABLE IF NOT EXISTS `onboarding_settings` (
  `id` text PRIMARY KEY NOT NULL,
  `completed_at` integer,
  `skipped_at` integer
);
