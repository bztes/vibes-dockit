import { isMap, parseDocument, stringify, YAMLMap } from 'yaml';

/**
 * Backup settings of a project live in the `x-dockit.restic` block of its
 * compose file. The restic template turns the settings of all projects into
 * resticprofile profiles (`conf/dockit.yaml` of the restic project), one per
 * project, inheriting the `default` profile of the user's `profiles.yaml`.
 * Key names follow restic / resticprofile.
 *
 *   x-dockit:
 *     restic:
 *       schedule: daily
 *       exclude: [/logs, '*.tmp']
 *       exclude-volumes: [app_cache]
 *       before-update: true
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

type Json = Record<string, unknown>;

const strings = (value: unknown) =>
	(Array.isArray(value) ? value : typeof value === 'string' ? [value] : [])
		.filter((v): v is string => typeof v === 'string')
		.map((v) => v.trim())
		.filter(Boolean);

/** The backup settings of a parsed compose file, `null` = not backed up. */
export function readRestic(json: Json): ResticSettings | null {
	const x = json['x-dockit'];
	if (!x || typeof x !== 'object') return null;
	const r = (x as Json).restic;
	if (r === undefined || r === null || r === false) return null;
	const o = (typeof r === 'object' ? r : {}) as Json;
	return {
		schedule: typeof o.schedule === 'string' ? o.schedule.trim() : '',
		exclude: strings(o.exclude),
		excludeVolumes: strings(o['exclude-volumes']),
		beforeUpdate: o['before-update'] === true
	};
}

/** Writes (or removes with `null`) the `x-dockit.restic` block, keeping comments and formatting. */
export function applyRestic(source: string, settings: ResticSettings | null): string {
	const doc = parseDocument(source);
	if (doc.errors.length) throw new Error(doc.errors[0].message);
	let x = doc.get('x-dockit', true);
	if (settings) {
		if (!isMap(x)) {
			if (!isMap(doc.contents)) throw new Error('The compose file is not a YAML map');
			const had = doc.has('x-dockit');
			x = new YAMLMap();
			doc.set('x-dockit', x);
			// put the block on top of the file, like the other x-dockit metadata
			if (!had) doc.contents.items.unshift(doc.contents.items.pop()!);
		}
		const block: Json = {};
		if (settings.schedule.trim()) block.schedule = settings.schedule.trim();
		if (settings.exclude.length) block.exclude = settings.exclude;
		if (settings.excludeVolumes.length) block['exclude-volumes'] = settings.excludeVolumes;
		if (settings.beforeUpdate) block['before-update'] = true;
		(x as YAMLMap).set('restic', doc.createNode(block));
	} else if (isMap(x)) {
		x.delete('restic');
		if (x.items.length === 0) doc.delete('x-dockit');
	}
	return doc.toString();
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

export interface ProfileSource {
	project: string;
	dir: string;
	/** volumes of the project that exist (exclusions not applied yet) */
	volumes: string[];
	settings: ResticSettings;
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
		const exclude = resolveExclude(s.dir, s.settings.exclude);
		if (exclude.length) backup.exclude = exclude;
		backup.tag = tag;
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
		'# Generated by Dockit from the backup settings of the projects (x-dockit.restic).\n' +
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
