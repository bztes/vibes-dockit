import { exec, type PresetDef } from './shared';

/**
 * Redis and its fork Valkey: SAVE writes the snapshot synchronously, so the
 * backed up volume is consistent. The volume stays in the backup.
 */
export function redisPreset(label: string, cli: string): PresetDef {
	return {
		label,
		description: 'SAVE before backups, so the backed up volume holds a current snapshot.',
		keepsVolumes: true,
		hooks: (c) => ({
			'pre-backup': [
				`out=$(${exec(c)} sh -c '[ -z "$REDIS_PASSWORD" ] || export REDISCLI_AUTH="$REDIS_PASSWORD"; ${cli} SAVE')`,
				'echo "$out"',
				'[ "$out" = OK ]'
			].join('\n')
		})
	};
}

export default redisPreset('Redis snapshot', 'redis-cli');
