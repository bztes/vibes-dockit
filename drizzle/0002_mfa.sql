CREATE TABLE `credential` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `credential_user_type_idx` ON `credential` (`user_id`,`type`);--> statement-breakpoint
ALTER TABLE `session` ADD `stage` text DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE `session` ADD `mfa_failures` integer DEFAULT 0 NOT NULL;