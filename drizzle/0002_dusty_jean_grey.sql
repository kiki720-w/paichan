CREATE TABLE `factory_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`factory` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`summary` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `factory_state_backup` (
	`id` text PRIMARY KEY NOT NULL,
	`factory` text NOT NULL,
	`data` text NOT NULL,
	`revision` integer NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`created_at` text NOT NULL
);
