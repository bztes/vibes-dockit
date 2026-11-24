import { stringify } from 'yaml';
import { DUMPS_DIR, hookCommand, phaseScripts, type Hooks, type Phase } from './hooks';

/**
 * Backup settings of a project live in the `restic` section of its
 * `dockit.json` (no section = not backed up). The restic template turns the
 * settings of all projects into resticprofile profiles (`conf/dockit.yaml` of the restic project), one per
 * project, inheriting the `default` profile of the user's `profiles.yaml`.
 * Key names follow restic / resticprofile.
 *
 *   "restic": {
 *     "schedule": "daily",
 *     "exclude": ["/logs", "*.tmp"],
 *     "exclude-volumes": ["app_cache"],
 *     "before-update": true
 *   }
 */
export interface ResticSettings {
	/** resticprofile schedule (systemd calendar syntax), empty = manual backups only */
	schedule: string;
	/** restic exclude patterns, a leading `/` is relative to the project folder */
	exclude: string[];
	/** names of docker volumes that are not backed up */
	excludeVolumes: string[];
	/** back up before every update */
	beforeUpdate: boolean;
}

export const DEFAULT_SETTINGS: ResticSettings = {
	schedule: 'daily',
	exclude: [],
	excludeVolumes: [],
	beforeUpdate: true
};

/** where the restic container sees the docker volumes */
export const VOLUMES_DIR = '/volumes';
/** where the restic container sees the config folder (`conf/` of the restic project) */
export const CONFIG_DIR = '/resticprofile';
/** stdout of the container, so scheduled runs show up in its logs */
const SCHEDULE_LOG = '/proc/1/fd/1';
const LOCK_WAIT = '2h';

import type { Json } from '#lib/dockit-config.js';

const strings = (value: unknown) =>
	(Array.isArray(value) ? value : typeof value === 'string' ? [value] : [])
		.filter((v): v is string => typeof v === 'string')
		.map((v) => v.trim())
		.filter(Boolean);

/** The backup settings from the restic section of `dockit.json`, `null` = not backed up. */
export function readRestic(section: Json | null): ResticSettings | null {
	if (!section) return null;
	return {
		schedule: typeof section.schedule === 'string' ? section.schedule.trim() : '',
		exclude: strings(section.exclude),
		excludeVolumes: strings(section['exclude-volumes']),
		beforeUpdate: section['before-update'] === true
	};
}

/** The restic section of `dockit.json` for the settings, `null` = not backed up. */
export function resticSection(settings: ResticSettings | null): Json | null {
	if (!settings) return null;
	const section: Json = {};
	if (settings.schedule.trim()) section.schedule = settings.schedule.trim();
	if (settings.exclude.length) section.exclude = settings.exclude;
	if (settings.excludeVolumes.length) section['exclude-volumes'] = settings.excludeVolumes;
	if (settings.beforeUpdate) section['before-update'] = true;
	return section;
}

/** Profile name of a project. Prefixed, so projects can't clash with reserved keys like `global`. */
export function profileName(project: string) {
	return `dockit-${project}`;
}

export function projectTag(project: string) {
	return `project=${project}`;
}

/** Path of a docker volume inside the restic container. */
export function volumePath(volume: string) {
	return `${VOLUMES_DIR}/${volume}/_data`;
}

/** The volume of a snapshot path, `null` for other paths. */
export function pathVolume(p: string) {
	const prefix = `${VOLUMES_DIR}/`;
	return p.startsWith(prefix) && p.endsWith('/_data')
		? p.slice(prefix.length, -'/_data'.length)
		: null;
}

/** The volumes in a snapshot. */
export function snapshotVolumes(snapshot: { paths: string[] }) {
	return snapshot.paths.map(pathVolume).filter((v) => v !== null);
}

/** Restic exclude patterns: a leading `/` (also after `!`) means the project folder. */
export function resolveExclude(dir: string, patterns: string[]) {
	return patterns.map((p) => {
		const negated = p.startsWith('!');
		const pattern = negated ? p.slice(1) : p;
		if (!pattern.startsWith('/')) return p;
		if (pattern.replace(/\/+/g, '') === '') return negated ? `!${dir}` : dir;
		const resolved = `${dir.replace(/\/+$/, '')}/${pattern.replace(/^\/+|\/+$/g, '')}`;
		return negated ? `!${resolved}` : resolved;
	});
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** One path component of a restic pattern (Go filepath.Match: `*`, `?`, `[...]`, `\`). */
function componentRegex(p: string) {
	let re = '';
	for (let i = 0; i < p.length; i++) {
		const c = p[i];
		const end = c === '[' ? p.indexOf(']', i + 1) : -1;
		if (c === '*') re += '[^/]*';
		else if (c === '?') re += '[^/]';
		else if (c === '\\' && i + 1 < p.length) re += escapeRegex(p[++i]);
		else if (end > i + 1) {
			let body = p.slice(i + 1, end);
			const negated = body.startsWith('^');
			if (negated) body = body.slice(1);
			re += `[${negated ? '^' : ''}${body.replace(/[[\]^]/g, '\\$&')}]`;
			i = end;
		} else re += escapeRegex(c);
	}
	return new RegExp(`^${re}$`);
}

/** `null` = `**` (any number of components) */
function matchParts(pattern: (RegExp | null)[], parts: string[], i = 0, j = 0): boolean {
	if (i === pattern.length) return j === parts.length;
	const p = pattern[i];
	if (p === null) {
		for (let k = j; k <= parts.length; k++) if (matchParts(pattern, parts, i + 1, k)) return true;
		return false;
	}
	return j < parts.length && p.test(parts[j]) && matchParts(pattern, parts, i + 1, j + 1);
}

/** Splits an absolute path into its components. */
export const pathParts = (abs: string) => abs.split('/').filter(Boolean);

/**
 * Tests absolute paths (as `pathParts`) against one restic exclude pattern, already
 * resolved with `resolveExclude`. Patterns not starting with `/` match at any depth.
 */
export function excludeMatcher(pattern: string) {
	const p = pattern.replace(/^!/, '');
	const compiled = pathParts(p).map((c) => (c === '**' ? null : componentRegex(c)));
	if (!p.startsWith('/')) compiled.unshift(null);
	return (parts: string[]) => matchParts(compiled, parts);
}

/** The project relative path a pattern names exactly (`/logs/` → `logs`), else `null`. */
export const patternPath = (pattern: string) =>
	pattern.startsWith('/') ? pathParts(pattern).join('/') : null;

/**
 * Compiles the patterns once. The checker tells which pattern excludes `rel` (relative to
 * the project folder `dir`), like restic: the last pattern matching the path or one of its
 * parent folders wins, `!` patterns include it again.
 */
export function excludeChecker(dir: string, patterns: string[]) {
	const root = pathParts(dir);
	const tests = resolveExclude(dir, patterns).map((resolved, i) => ({
		test: excludeMatcher(resolved),
		by: resolved.startsWith('!') ? null : patterns[i]
	}));
	return (rel: string) => {
		const parts = pathParts(rel);
		const paths = parts.map((_, i) => [...root, ...parts.slice(0, i + 1)]);
		let by: string | null = null;
		for (const t of tests) if (paths.some(t.test)) by = t.by;
		return by;
	};
}

export interface ProfileSource {
	project: string;
	dir: string;
	/** volumes of the project that exist (exclusions not applied yet) */
	volumes: string[];
	settings: ResticSettings;
	hooks: Hooks;
}

/** unfinished dumps of the hooks */
const DUMP_EXCLUDES = [`/${DUMPS_DIR}/*.tmp`];

/** resticprofile run hooks of a phase (none = `undefined`). */
function runHooks(source: ProfileSource, phase: Phase) {
	const scripts = phaseScripts(source.hooks, phase);
	return scripts.length
		? scripts.map((s) => hookCommand(source.dir, phase, s.name, s.script))
		: undefined;
}

/** Sources of a project's backup: the project folder and its volumes. */
function backupSources(source: ProfileSource) {
	const skip = new Set(source.settings.excludeVolumes);
	return [source.dir, ...source.volumes.filter((v) => !skip.has(v)).map(volumePath)];
}

/** `conf/dockit.yaml`: one profile per backed up project. */
export function dockitProfiles(sources: ProfileSource[]) {
	const config: Json = { version: '1', global: { scheduler: 'crond' } };
	for (const s of [...sources].sort((a, b) => a.project.localeCompare(b.project))) {
		const tag = [projectTag(s.project)];
		const backup: Json = { source: backupSources(s) };
		backup.exclude = resolveExclude(s.dir, [...s.settings.exclude, ...DUMP_EXCLUDES]);
		backup.tag = tag;
		const hooks = {
			'run-before': runHooks(s, 'pre-backup'),
			'run-after': runHooks(s, 'post-backup'),
			'run-after-fail': runHooks(s, 'backup-failed')
		};
		for (const [key, value] of Object.entries(hooks)) if (value) backup[key] = value;
		if (s.settings.schedule) {
			backup.schedule = s.settings.schedule;
			backup['schedule-permission'] = 'system';
			backup['schedule-lock-wait'] = LOCK_WAIT;
			backup['schedule-log'] = SCHEDULE_LOG;
		}
		config[profileName(s.project)] = {
			inherit: 'default',
			backup,
			// by tag, not by path: excluding a volume must not orphan the older snapshots
			retention: { path: false, tag, 'group-by': 'tags' }
		};
	}
	return (
		'# Generated by Dockit from the backup settings of the projects (restic in dockit.json).\n' +
		'# Do not edit — your own settings go into profiles.yaml.\n' +
		stringify(config, { aliasDuplicateObjects: false })
	);
}

export interface Retention {
	keepDaily: number;
	keepWeekly: number;
	keepMonthly: number;
}

/**
 * `conf/profiles.yaml`: the user's part of the configuration.
 * `retention: null` = append-only repository: forget and prune would fail on it.
 */
export function mainProfiles(repository: string, retention: Retention | null) {
	const header = `# resticprofile configuration — https://creativeprojects.github.io/resticprofile/
# Every project with backups enabled gets a profile in dockit.yaml that inherits
# from "default". Keep backup sources and excludes out of "default": they are
# set per project in Dockit.
version: "1"

includes:
  - dockit.yaml

default:
  repository: ${JSON.stringify(repository)}
  password-file: password
  initialize: true
`;
	if (!retention) {
		return `${header}
# The repository is append-only: snapshots can't be forgotten or pruned from
# here. Do that with full access to the repository, e.g. on the server.
`;
	}
	return `${header}  # applied to every project after its backup
  retention:
    after-backup: true
    keep-daily: ${retention.keepDaily}
    keep-weekly: ${retention.keepWeekly}
    keep-monthly: ${retention.keepMonthly}

# removes the data of forgotten snapshots from the repository
prune:
  inherit: default
  prune:
    schedule: "Sun 04:00"
    schedule-permission: system
    schedule-lock-wait: ${LOCK_WAIT}
    schedule-log: ${SCHEDULE_LOG}
`;
}

/** Host path of a local repository (it has to be mounted into the container). */
export function localRepository(repository: string) {
	const repo = repository.trim().replace(/^local:/, '');
	return repo.startsWith('/') ? repo.replace(/\/+$/, '') || '/' : null;
}

const BACKENDS: Record<string, string> = {
	local: 'Folder on this host',
	rest: 'REST server',
	s3: 'S3',
	b2: 'Backblaze B2',
	sftp: 'SFTP',
	azure: 'Azure Blob Storage',
	gs: 'Google Cloud Storage',
	swift: 'OpenStack Swift',
	rclone: 'rclone'
};

export interface RepositoryInfo {
	/** restic backend, e.g. `local`, `rest`, `s3` */
	backend: string;
	/** human readable backend */
	label: string;
	/** the repository without the backend prefix */
	location: string;
	problem: string | null;
}

/** What a restic repository string points to, `null` = empty. */
export function parseRepository(repository: string): RepositoryInfo | null {
	const value = repository.trim();
	if (!value) return null;
	const prefix = /^([a-z0-9]+):/.exec(value)?.[1];
	const backend = prefix && prefix in BACKENDS ? prefix : 'local';
	const location = backend === prefix ? value.slice(prefix.length + 1) : value;
	const info = { backend, label: BACKENDS[backend], location, problem: null as string | null };
	if (backend === 'local') {
		if (prefix && prefix !== 'local') info.problem = `Unknown repository type ${prefix}:`;
		else if (!localRepository(value)) {
			info.problem = 'A folder has to be an absolute path, e.g. /srv/backups/restic';
		}
	} else if (!location) {
		info.problem = `The ${info.label} location is missing`;
	} else if (backend === 'rest') {
		info.problem = restUrlProblem(location);
	}
	return info;
}

function restUrlProblem(url: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return 'Invalid REST server URL, e.g. rest:https://backup.example.com:8000/';
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return 'The REST server URL has to start with http:// or https://';
	}
	if (parsed.username || parsed.password) {
		return 'Put the username and password into their own fields, not into the URL';
	}
	return null;
}

/** Problem with the repository of the restic template form, `null` = fine. */
export function repositoryProblem(values: {
	repository: string;
	restUser: string;
	restPassword: string;
}): string | null {
	const info = parseRepository(values.repository);
	if (!info) return 'A repository is required';
	if (info.problem) return info.problem;
	if (info.backend === 'rest' && /['\n\r]/.test(values.restUser + values.restPassword)) {
		return 'Single quotes are not supported in the REST server credentials';
	}
	return null;
}

/** A value for the `.env` file, taken literally by docker compose (no `$` interpolation). */
export function envValue(value: string) {
	if (/['\n\r]/.test(value)) throw new Error('Single quotes and line breaks are not supported');
	return `'${value}'`;
}

export interface Snapshot {
	id: string;
	shortId: string;
	time: string;
	paths: string[];
	tags: string[];
	/** bytes added to the repository by this snapshot (restic ≥ 0.17) */
	added: number | null;
	/** size of the backed up files */
	size: number | null;
}

/** Parses `restic snapshots --json` (the json may be surrounded by log lines). */
export function parseSnapshots(stdout: string): Snapshot[] {
	const line = stdout
		.split('\n')
		.map((l) => l.trim())
		.find((l) => l.startsWith('['));
	if (!line) throw new Error(stdout.trim() || 'restic returned no snapshots');
	const list = JSON.parse(line) as {
		id: string;
		short_id?: string;
		time: string;
		paths?: string[];
		tags?: string[];
		summary?: { data_added?: number; total_bytes_processed?: number };
	}[];
	return list
		.map((s) => ({
			id: s.id,
			shortId: s.short_id ?? s.id.slice(0, 8),
			time: s.time,
			paths: s.paths ?? [],
			tags: s.tags ?? [],
			added: s.summary?.data_added ?? null,
			size: s.summary?.total_bytes_processed ?? null
		}))
		.sort((a, b) => b.time.localeCompare(a.time));
}
