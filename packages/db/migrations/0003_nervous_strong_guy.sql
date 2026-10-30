CREATE TABLE `allocation_override` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`run_id` text NOT NULL,
	`registration_id` text NOT NULL,
	`from_session_id` text,
	`to_session_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `allocation_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`registration_id`) REFERENCES `registration`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_session_id`) REFERENCES `event_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_session_id`) REFERENCES `event_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `allocation_override_run_idx` ON `allocation_override` (`run_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `allocation_run` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`event_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`strategy` text NOT NULL,
	`fill_unassigned` text NOT NULL,
	`seed` text NOT NULL,
	`engine_version` text NOT NULL,
	`input_hash` text NOT NULL,
	`input_key` text NOT NULL,
	`result_key` text NOT NULL,
	`metrics` text NOT NULL,
	`parent_run_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`published_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `allocation_run_event_idx` ON `allocation_run` (`event_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `allocation_run_published_idx` ON `allocation_run` (`event_id`) WHERE status = 'published';--> statement-breakpoint
CREATE TABLE `preference` (
	`registration_id` text NOT NULL,
	`workshop_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`event_id` text NOT NULL,
	`rank` integer NOT NULL,
	PRIMARY KEY(`registration_id`, `workshop_id`),
	FOREIGN KEY (`registration_id`) REFERENCES `registration`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workshop_id`) REFERENCES `workshop`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `preference_registration_rank_idx` ON `preference` (`registration_id`,`rank`);--> statement-breakpoint
CREATE INDEX `preference_event_idx` ON `preference` (`event_id`);