CREATE TABLE `poll` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`created_by_user_id` text,
	`group_id` text,
	`share_code` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`timezone` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`day_start_minutes` integer NOT NULL,
	`day_end_minutes` integer NOT NULL,
	`duration_minutes` integer NOT NULL,
	`decision_mode` text DEFAULT 'manual' NOT NULL,
	`deadline_at` integer,
	`min_attendees` integer,
	`show_names` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`confirmed_starts_at` integer,
	`confirmed_ends_at` integer,
	`confirmed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`group_id`) REFERENCES `poll_group`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "poll_dates_check" CHECK("poll"."ends_on" >= "poll"."starts_on"),
	CONSTRAINT "poll_hours_check" CHECK("poll"."day_start_minutes" >= 0 and "poll"."day_end_minutes" <= 1440 and "poll"."day_end_minutes" > "poll"."day_start_minutes"),
	CONSTRAINT "poll_duration_check" CHECK("poll"."duration_minutes" >= 30)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `poll_share_code_idx` ON `poll` (`share_code`);--> statement-breakpoint
CREATE INDEX `poll_organization_idx` ON `poll` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `poll_due_idx` ON `poll` (`status`,`decision_mode`,`deadline_at`);--> statement-breakpoint
CREATE TABLE `poll_group` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `poll_group_organization_idx` ON `poll_group` (`organization_id`);--> statement-breakpoint
CREATE TABLE `poll_group_member` (
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`),
	FOREIGN KEY (`group_id`) REFERENCES `poll_group`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `poll_respondent` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`poll_id` text NOT NULL,
	`user_id` text,
	`display_name` text NOT NULL,
	`email` text,
	`edit_token_hash` text,
	`availability` text DEFAULT '{"free":[],"ifNeeded":[]}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`poll_id`) REFERENCES `poll`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `poll_respondent_poll_idx` ON `poll_respondent` (`poll_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `poll_respondent_user_idx` ON `poll_respondent` (`poll_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `poll_respondent_token_idx` ON `poll_respondent` (`edit_token_hash`);