import { isObject, type Json } from '#lib/dockit-config.js';
import { PRESET_INFO, presetHooks, type Preset } from './presets';
import { DUMPS_DIR, quote } from './presets/shared';

export { DUMPS_DIR };

/**
 * Backup hooks: shell scripts that run before and after backups and restores,
 * e.g. a database dump. They live in the `restic-hooks` section of a project's
 * `dockit.json`, one set per service:
 *
 *   "restic-hooks": {
 *     "db": {
 *       "pre-backup": "docker exec myapp-db-1 pg_dump -Fc -U postgres app >.backup/db.dump"
 *     }
 *   }
 *
 * They run in the restic container (`sh -e`, in the project folder), which
 * has the docker CLI and socket: commands inside a service run with
 * `docker exec <container>`. Dumps go to `.backup/`, which is backed up with
 * the project files. Backup hooks are resticprofile run hooks (scheduled
 * backups run them without Dockit), restore hooks are run by Dockit.
 */
export const PHASES = [
	'pre-backup',
	'post-backup',
	'backup-failed',
	'pre-restore',
	'post-restore',
	'restore-failed'
] as const;
export type Phase = (typeof PHASES)[number];

export const HOOKS_SECTION = 'restic-hooks';

/** The scripts of one set of hooks, by phase (only phases with a script). */
export type HookSet = Partial<Record<Phase, string>>;
/** The hook sets of a project, by name (usually the service). */
export type Hooks = Record<string, HookSet>;

/** The hooks from the `restic-hooks` section of `dockit.json`. */
export function readHooks(section: Json | null): Hooks {
	if (!section) return {};
	const hooks: Hooks = {};
	for (const [name, value] of Object.entries(section)) {
		if (!isObject(value)) continue;
		const set: HookSet = {};
		for (const phase of PHASES) {
			const script = value[phase];
			if (typeof script === 'string' && script.trim()) set[phase] = script.trim();
		}
		hooks[name] = set;
	}
	return hooks;
}

/** The `restic-hooks` section for the hooks, `null` = no hooks. */
export function hooksSection(hooks: Hooks): Json | null {
	const clean = readHooks(hooks as Json);
	return Object.keys(clean).length ? (clean as Json) : null;
}

/** The scripts of a phase, in the order of the sets. */
export function phaseScripts(hooks: Hooks, phase: Phase) {
	return Object.entries(hooks).flatMap(([name, set]) =>
		set[phase] ? [{ name, script: set[phase] }] : []
	);
}

/** The command that runs a hook script of a project in the restic container. */
export function hookCommand(dir: string, phase: Phase, name: string, script: string) {
	return `set -e\necho ${quote(`--- ${phase} hooks of ${name}`)}\ncd ${quote(dir)}\n${script}\n`;
}

/** Name of the container of a compose service (one replica). */
export function containerName(service: Json, name: string, composeName: string) {
	return typeof service.container_name === 'string'
		? service.container_name
		: `${composeName}-${name}-1`;
}

const services = (json: Json) =>
	(isObject(json.services) ? json.services : {}) as Record<string, Json | null>;

/** Docker names of the named volumes of a service (external ones are not ours). */
function serviceVolumes(json: Json, service: Json, composeName: string) {
	const top = (json.volumes && typeof json.volumes === 'object' ? json.volumes : {}) as Record<
		string,
		Json | null
	>;
	const mounts = Array.isArray(service.volumes) ? service.volumes : [];
	return mounts.flatMap((m) => {
		const source =
			typeof m === 'string'
				? m.split(':')[0]
				: m && typeof m === 'object' && (m as Json).type === 'volume'
					? (m as Json).source
					: undefined;
		if (typeof source !== 'string' || !(source in top)) return [];
		const def = top[source] ?? {};
		if (def.external) return [];
		return [typeof def.name === 'string' ? def.name : `${composeName}_${source}`];
	});
}

/**
 * The hooks of a preset for a service of the (merged) compose file. Returns
 * the hooks with the new set and, for presets that dump the database, the
 * volumes of the service: their raw files are not needed in the backup anymore.
 */
export function addHooks(
	compose: Json,
	hooks: Hooks,
	service: string,
	composeName: string,
	preset: Preset = 'custom'
) {
	const target = services(compose)[service];
	if (!target) throw new Error(`There is no service ${service}`);
	if (service in hooks) throw new Error(`${service} already has hooks`);
	return {
		hooks: {
			...hooks,
			[service]: presetHooks(preset, containerName(target, service, composeName), service)
		},
		volumes: PRESET_INFO[preset].keepsVolumes ? [] : serviceVolumes(compose, target, composeName)
	};
}

/** Services hooks can be added for: the ones without hooks. */
export function hookCandidates(json: Json, hooks: Hooks) {
	return Object.keys(services(json)).filter((name) => !(name in hooks));
}

/** The services with hooks that exist in the compose file, e.g. to start them for a restore. */
export function hookedServices(json: Json | null, hooks: Hooks) {
	const all = json ? services(json) : {};
	return Object.keys(hooks).filter((name) => name in all);
}
