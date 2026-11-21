import { DUMPS_DIR, dumpTo, exec, execIn, noDump, waitFor, type PresetDef } from './shared';

const login = 'export PGUSER="${POSTGRES_USER:-postgres}"; db="${POSTGRES_DB:-$PGUSER}"';

export default {
	label: 'PostgreSQL dump',
	description: 'pg_dump before backups, pg_restore after restores. The volume is left out.',
	keepsVolumes: false,
	hooks: (c, name) => {
		const file = `${DUMPS_DIR}/${name}.dump`;
		return {
			'pre-backup': dumpTo(`${exec(c)} sh -c '${login}; pg_dump -Fc "$db"'`, file),
			'post-restore': [
				noDump(file),
				waitFor(`${exec(c)} pg_isready -q`, c),
				`${execIn(c)} sh -c '${login}; pg_restore --clean --if-exists --single-transaction -d "$db"' <${file}`
			].join('\n')
		};
	}
} satisfies PresetDef;
