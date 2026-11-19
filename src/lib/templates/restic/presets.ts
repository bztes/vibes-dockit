/** Hook templates, chosen when a runner is added (no imports: also used by the client). */
export const PRESET_INFO = {
	custom: {
		label: 'Empty (custom hooks)',
		description: 'An empty runner: write your own HOOK_* commands in the compose file.',
		keepsVolumes: true
	},
	postgres: {
		label: 'PostgreSQL dump',
		description: 'pg_dump before backups, pg_restore after restores. The volume is left out.',
		keepsVolumes: false
	},
	mysql: {
		label: 'MySQL dump',
		description: 'mysqldump of all databases, restored with mysql. The volume is left out.',
		keepsVolumes: false
	},
	mariadb: {
		label: 'MariaDB dump',
		description: 'mariadb-dump of all databases, restored with mariadb. The volume is left out.',
		keepsVolumes: false
	},
	mongo: {
		label: 'MongoDB dump',
		description: 'mongodump archive, restored with mongorestore. The volume is left out.',
		keepsVolumes: false
	},
	// only make the files of the volume consistent (the snapshot is written): it stays in the backup
	redis: {
		label: 'Redis snapshot',
		description: 'SAVE before backups, so the backed up volume holds a current snapshot.',
		keepsVolumes: true
	},
	valkey: {
		label: 'Valkey snapshot',
		description: 'SAVE before backups, so the backed up volume holds a current snapshot.',
		keepsVolumes: true
	},
	influxdb: {
		label: 'InfluxDB 2 backup',
		description: 'influx backup, restored with influx restore --full. Needs an operator token.',
		keepsVolumes: false
	}
} as const satisfies Record<string, { label: string; description: string; keepsVolumes: boolean }>;

export type Preset = keyof typeof PRESET_INFO;
export const PRESETS = Object.keys(PRESET_INFO) as [Preset, ...Preset[]];
