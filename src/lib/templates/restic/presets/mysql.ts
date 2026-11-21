import { DUMPS_DIR, dumpTo, exec, execIn, noDump, waitFor, type PresetDef } from './shared';

/** MySQL and its fork MariaDB: the same scripts with their own tools. */
export function mysqlPreset(
	label: string,
	tools: { dump: string; admin: string; client: string; password: string }
): PresetDef {
	const login = `export MYSQL_PWD="${tools.password}"`;
	return {
		label,
		description: `${tools.dump} of all databases, restored with ${tools.client}. The volume is left out.`,
		keepsVolumes: false,
		hooks: (c, name) => {
			const file = `${DUMPS_DIR}/${name}.sql`;
			return {
				'pre-backup': dumpTo(
					`${exec(c)} sh -c '${login}; ${tools.dump} -uroot --single-transaction --routines --events --all-databases'`,
					file
				),
				'post-restore': [
					noDump(file),
					waitFor(`${exec(c)} sh -c '${login}; ${tools.admin} -uroot ping --silent'`, c),
					`${execIn(c)} sh -c '${login}; ${tools.client} -uroot' <${file}`
				].join('\n')
			};
		}
	};
}

export default mysqlPreset('MySQL dump', {
	dump: 'mysqldump',
	admin: 'mysqladmin',
	client: 'mysql',
	password: '$MYSQL_ROOT_PASSWORD'
});
