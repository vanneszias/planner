CREATE TABLE `assignment` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`event_id` text NOT NULL,
	`registration_id` text NOT NULL,
	`session_id` text NOT NULL,
	`source` text NOT NULL,
	`run_id` text,
	`locked` integer DEFAULT false NOT NULL,
	`checked_in_at` integer,
	`checked_in_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`registration_id`) REFERENCES `registration`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `event_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assignment_registration_session_idx` ON `assignment` (`registration_id`,`session_id`);--> statement-breakpoint
CREATE INDEX `assignment_session_idx` ON `assignment` (`session_id`);--> statement-breakpoint
CREATE INDEX `assignment_event_idx` ON `assignment` (`event_id`);--> statement-breakpoint
CREATE TABLE `email_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`event_id` text,
	`idempotency_key` text NOT NULL,
	`kind` text NOT NULL,
	`registration_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`provider_message_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`registration_id`) REFERENCES `registration`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_delivery_idempotency_key_unique` ON `email_delivery` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `registration` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`event_id` text NOT NULL,
	`user_id` text,
	`managed_by_user_id` text,
	`registered_by` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`guardian_email` text,
	`age_group_id` text,
	`is_minor` integer DEFAULT false NOT NULL,
	`access_token_hash` text NOT NULL,
	`short_code_hash` text NOT NULL,
	`feed_token_hash` text,
	`preferences_submitted_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`anonymised_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`managed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`age_group_id`) REFERENCES `age_group`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registration_access_token_idx` ON `registration` (`access_token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `registration_short_code_idx` ON `registration` (`event_id`,`short_code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `registration_feed_token_idx` ON `registration` (`feed_token_hash`);--> statement-breakpoint
CREATE INDEX `registration_event_status_idx` ON `registration` (`event_id`,`status`);--> statement-breakpoint
CREATE INDEX `registration_user_idx` ON `registration` (`user_id`);--> statement-breakpoint
CREATE INDEX `registration_managed_by_idx` ON `registration` (`managed_by_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `registration_event_email_idx` ON `registration` (`event_id`,`email`);--> statement-breakpoint
CREATE TABLE `waitlist_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`event_id` text NOT NULL,
	`session_id` text NOT NULL,
	`registration_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `event_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`registration_id`) REFERENCES `registration`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waitlist_session_registration_idx` ON `waitlist_entry` (`session_id`,`registration_id`);--> statement-breakpoint
CREATE INDEX `waitlist_session_created_idx` ON `waitlist_entry` (`session_id`,`created_at`);