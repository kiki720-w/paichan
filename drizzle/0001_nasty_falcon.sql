CREATE TABLE `factory_state` (
	`factory` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL
);

INSERT OR IGNORE INTO `factory_state` (`factory`,`data`,`updated_at`)
SELECT 'xingping',`data`,CURRENT_TIMESTAMP FROM `app_state` WHERE `id`=1;
