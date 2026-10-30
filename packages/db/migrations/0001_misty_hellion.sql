CREATE TABLE `age_group` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`event_id` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `age_group_event_idx` ON `age_group` (`event_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`event_id` text,
	`actor_user_id` text,
	`actor_kind` text NOT NULL,
	`action` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`data` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_log_organization_idx` ON `audit_log` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_event_idx` ON `audit_log` (`event_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `event` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`timezone` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`mode` text DEFAULT 'booking' NOT NULL,
	`default_locale` text DEFAULT 'en' NOT NULL,
	`sessions_per_participant` integer DEFAULT 3 NOT NULL,
	`rank_limit` integer DEFAULT 5 NOT NULL,
	`rank_minimum` integer,
	`show_times_while_ranking` integer DEFAULT true NOT NULL,
	`show_explanations` integer DEFAULT false NOT NULL,
	`fill_unassigned` text DEFAULT 'none' NOT NULL,
	`allocation_strategy` text DEFAULT 'take-turns' NOT NULL,
	`change_cutoff` text DEFAULT 'booking-closes' NOT NULL,
	`opens_at` integer,
	`closes_at` integer,
	`retention_days` integer DEFAULT 90 NOT NULL,
	`data_deleted_at` integer,
	`logo_key` text,
	`accent_color` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "event_dates_check" CHECK("event"."ends_on" >= "event"."starts_on"),
	CONSTRAINT "event_sessions_check" CHECK("event"."sessions_per_participant" between 1 and 20),
	CONSTRAINT "event_rank_limit_check" CHECK("event"."rank_limit" between 1 and 20)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_organization_slug_idx` ON `event` (`organization_id`,`slug`);--> statement-breakpoint
CREATE INDEX `event_organization_starts_idx` ON `event` (`organization_id`,`starts_on`);--> statement-breakpoint
CREATE TABLE `event_session` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`event_id` text NOT NULL,
	`workshop_id` text NOT NULL,
	`location_id` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`capacity` integer NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workshop_id`) REFERENCES `workshop`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `location`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "event_session_times_check" CHECK("event_session"."ends_at" > "event_session"."starts_at"),
	CONSTRAINT "event_session_capacity_check" CHECK("event_session"."capacity" >= 0)
);
--> statement-breakpoint
CREATE INDEX `event_session_event_starts_idx` ON `event_session` (`event_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `event_session_workshop_idx` ON `event_session` (`workshop_id`);--> statement-breakpoint
CREATE TABLE `location` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `location_event_idx` ON `location` (`event_id`);--> statement-breakpoint
CREATE TABLE `slug_redirect` (
	`old_path` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`event_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workshop` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`event_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`image_key` text,
	`facilitator_name` text,
	`category` text,
	`marker_color` text NOT NULL,
	`marker_shape` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workshop_event_idx` ON `workshop` (`event_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `workshop_age_group` (
	`workshop_id` text NOT NULL,
	`age_group_id` text NOT NULL,
	PRIMARY KEY(`workshop_id`, `age_group_id`),
	FOREIGN KEY (`workshop_id`) REFERENCES `workshop`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`age_group_id`) REFERENCES `age_group`(`id`) ON UPDATE no action ON DELETE cascade
);
