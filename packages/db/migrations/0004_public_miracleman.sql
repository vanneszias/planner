CREATE TABLE `export_job` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`event_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`r2_key` text,
	`rows` integer,
	`requested_by` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `export_job_event_idx` ON `export_job` (`event_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `export_job_expires_idx` ON `export_job` (`status`,`expires_at`);--> statement-breakpoint
ALTER TABLE `registration` ADD `checked_in_at` integer;--> statement-breakpoint
ALTER TABLE `registration` ADD `checked_in_by` text;