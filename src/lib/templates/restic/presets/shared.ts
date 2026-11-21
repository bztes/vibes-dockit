import type { HookSet } from '../hooks';

/** folder of the dumps in a project */
export const DUMPS_DIR = '.backup';

/** A shell word (the folders come from the projects root, they could contain spaces). */
export const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * A hook template, chosen when hooks are added for a service. The scripts run
 * in the project folder of the restic container: commands in the service run
 * with `docker exec`, dumps go to {@link DUMPS_DIR}.
 */
export interface PresetDef {
	label: string;
	description: string;
	/** the volumes of the service stay in the backup (the dump doesn't replace them) */
	keepsVolumes: boolean;
	/** the hooks for the container `c` of the service `name` */
	hooks: (c: string, name: string) => HookSet;
}

export const exec = (c: string) => `docker exec ${c}`;
/** with stdin, e.g. to restore a dump */
export const execIn = (c: string) => `docker exec -i ${c}`;

/** Waits up to 2 minutes until `check` succeeds (the database may initialize first). */
export const waitFor = (check: string, what: string) =>
	[
		'i=0',
		`until ${check} >/dev/null 2>&1; do`,
		`\ti=$((i + 1)); [ "$i" -lt 120 ] || { echo ${quote(`${what} did not get ready`)}; exit 1; }`,
		'\tsleep 1',
		'done'
	].join('\n');

/** Ends a restore hook without a dump (`test`: `-f` file, `-d` folder). */
export const noDump = (file: string, test = '-f') =>
	`[ ${test} ${file} ] || { echo "No dump to restore"; exit 0; }`;

/** Writes the output of `command` to `file` (`.tmp` first: a failed dump keeps the last one). */
export const dumpTo = (command: string, file: string) =>
	[`mkdir -p ${DUMPS_DIR}`, `${command} >${file}.tmp`, `mv ${file}.tmp ${file}`].join('\n');
