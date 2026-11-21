import { DUMPS_DIR, dumpTo, exec, execIn, noDump, waitFor, type PresetDef } from './shared';

const login =
	'[ -z "$MONGO_INITDB_ROOT_USERNAME" ] || set -- --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin';

export default {
	label: 'MongoDB dump',
	description: 'mongodump archive, restored with mongorestore. The volume is left out.',
	keepsVolumes: false,
	hooks: (c, name) => {
		const file = `${DUMPS_DIR}/${name}.archive`;
		return {
			'pre-backup': dumpTo(`${exec(c)} sh -c '${login}; mongodump "$@" --archive'`, file),
			'post-restore': [
				noDump(file),
				waitFor(`${exec(c)} mongosh --quiet --eval 1`, c),
				`${execIn(c)} sh -c '${login}; mongorestore "$@" --drop --archive' <${file}`
			].join('\n')
		};
	}
} satisfies PresetDef;
