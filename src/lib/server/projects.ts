import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { PROJECTS_ROOT } from '$app/env/private';
import { run } from './exec';
import { getSelf } from './self';
import { maskEnv, unmaskEnv } from '#lib/env.js';
import { matchTemplate, syncTemplates, templateLinks } from './templates';
import { migrateProject } from './migrate';
import { LEGACY_KEY } from './legacy';
import {
	DOCKIT_FILE,
	NEW_OVERRIDE_FILE,
	OVERRIDE_FILES,
	hasContent,
	isObject,
	mergeCompose,
	parseConfig,
	parseYamlMap,
	stringifyConfig,
	type DockitConfig,
	type Json
} from '#lib/dockit-config.js';

export const COMPOSE_FILES = [
	'compose.yaml',
	'compose.yml',
	'docker-compose.yml',
	'docker-compose.yaml'
];
export const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/;

export interface ProjectMeta {
	description?: string;
	url?: string;
	autoUpdate?: boolean;
	icon?: string;
}

export interface ProjectInfo {
	/** folder name, used as id */
	name: string;
	dir: string;
	composeFile: string | null;
	/** compose override file, where Dockit puts its changes to the compose setup */
	overrideFile: string | null;
	/** docker compose project name */
	composeName: string;
	meta: ProjectMeta;
	services: { name: string; image: string | null; build: boolean }[];
	/** links added by template configuration (e.g. caddy domains) */
	links: string[];
	/** id of the template this project is an instance of */
	template: string | null;
	parseError: string | null;
	isSelf: boolean;
	/** `dockit.json` */
	config: DockitConfig;
	/** compose file merged with the override, `null` = it can't be parsed */
	compose: Record<string, unknown> | null;
}

/** Throws when PROJECTS_ROOT is missing or not a directory. Called once at server start. */
export function checkRoot() {
	if (!PROJECTS_ROOT) {
		throw new Error('PROJECTS_ROOT is required, e.g. PROJECTS_ROOT=/opt/stacks');
	}
	if (!existsSync(PROJECTS_ROOT) || !statSync(PROJECTS_ROOT).isDirectory()) {
		throw new Error(`PROJECTS_ROOT ${PROJECTS_ROOT} does not exist or is not a directory`);
	}
}

/** absolute path from the PROJECTS_ROOT env var (checked by checkRoot at startup) */
export function getRoot(): string {
	return PROJECTS_ROOT!;
}

export function requireRoot(): string {
	const root = getRoot();
	if (!existsSync(root)) error(400, `Projects root ${root} does not exist`);
	return root;
}

export function projectDir(name: string) {
	if (!NAME_RE.test(name)) error(400, 'Invalid project name');
	return path.join(requireRoot(), name);
}

export function normalizeComposeName(name: string) {
	return name.toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

export function findComposeFile(dir: string) {
	for (const f of COMPOSE_FILES) {
		if (existsSync(path.join(dir, f))) return f;
	}
	return null;
}

export function findOverrideFile(dir: string) {
	for (const f of OVERRIDE_FILES) {
		if (existsSync(path.join(dir, f))) return f;
	}
	return null;
}

/** Parses a compose (override) file (no interpolation). Throws on YAML errors. */
export function parseYaml(source: string) {
	return parseYamlMap(source).toJS() as Json;
}

/** Services and name of a parsed compose file. */
function composeServices(json: Record<string, unknown>) {
	const services = Object.entries(
		(isObject(json.services) ? json.services : {}) as Record<
			string,
			{ image?: unknown; build?: unknown } | null
		>
	).map(([name, s]) => ({
		name,
		image: typeof s?.image === 'string' ? s.image : null,
		build: s?.build !== undefined
	}));
	return { name: typeof json.name === 'string' ? json.name : null, services };
}

function metaOf(config: DockitConfig): ProjectMeta {
	return {
		description: typeof config.description === 'string' ? config.description : undefined,
		url: typeof config.url === 'string' ? config.url : undefined,
		autoUpdate: config.autoUpdate === true,
		icon: typeof config.icon === 'string' ? config.icon : undefined
	};
}

export async function loadProject(name: string): Promise<ProjectInfo> {
	const dir = projectDir(name);
	if (!existsSync(dir)) error(404, `Project ${name} not found`);
	return readProject(name, dir);
}

export const readOptional = (file: string) => readFile(file, 'utf8').catch(() => null);

/** The raw files of a project: compose file, override file (if any) and `dockit.json`. */
async function readFiles(dir: string, composeFile: string) {
	const overrideFile = findOverrideFile(dir);
	const [compose, override, config] = await Promise.all([
		readFile(path.join(dir, composeFile), 'utf8'),
		overrideFile ? readOptional(path.join(dir, overrideFile)) : null,
		readOptional(path.join(dir, DOCKIT_FILE))
	]);
	return { overrideFile, compose, override: override ?? '', config };
}

/** Parses `dockit.json` (`null` = no file), the error message is prefixed with the file name. */
function parseConfigFile(source: string | null): DockitConfig {
	try {
		return source !== null ? parseConfig(source) : {};
	} catch (e) {
		throw new Error(`${DOCKIT_FILE}: ${e instanceof Error ? e.message : e}`, { cause: e });
	}
}

async function readProject(name: string, dir: string): Promise<ProjectInfo> {
	const composeFile = findComposeFile(dir);
	const info: ProjectInfo = {
		name,
		dir,
		composeFile,
		overrideFile: null,
		composeName: normalizeComposeName(name),
		meta: {},
		services: [],
		links: [],
		template: null,
		parseError: null,
		isSelf: getSelf()?.project === name,
		config: {},
		compose: null
	};
	if (!composeFile) return info;
	let files = await readFiles(dir, composeFile);
	if (files.config === null && files.compose.includes(LEGACY_KEY)) {
		await migrateProject(name, dir, composeFile, files.compose);
		files = await readFiles(dir, composeFile);
	}
	info.overrideFile = files.overrideFile;
	try {
		info.compose = mergeCompose(
			parseYaml(files.compose),
			files.override ? parseYaml(files.override) : null
		);
		const parsed = composeServices(info.compose);
		if (parsed.name) info.composeName = normalizeComposeName(parsed.name);
		info.services = parsed.services;
		info.template = matchTemplate(parsed.services);
	} catch (e) {
		info.parseError = e instanceof Error ? e.message : String(e);
	}
	try {
		info.config = parseConfigFile(files.config);
	} catch (e) {
		info.parseError ??= (e as Error).message;
	}
	info.meta = metaOf(info.config);
	info.links = templateLinks(info.config);
	return info;
}

export async function listProjects(): Promise<ProjectInfo[]> {
	const root = getRoot();
	if (!existsSync(root)) return [];
	const entries = await readdir(root, { withFileTypes: true });
	const dirs = entries.filter(
		(e) => e.isDirectory() && !e.name.startsWith('.') && NAME_RE.test(e.name)
	);
	const projects = await Promise.all(dirs.map((d) => readProject(d.name, path.join(root, d.name))));
	return projects
		.filter((p) => p.composeFile)
		.sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// files

export async function readProjectFiles(name: string) {
	const project = await loadProject(name);
	const composeFile = project.composeFile ?? 'compose.yaml';
	const compose = await readFile(path.join(project.dir, composeFile), 'utf8').catch(() => '');
	const env = await readFile(path.join(project.dir, '.env'), 'utf8').catch(() => '');
	// secret values never leave the server
	return { composeFile, compose, env: maskEnv(env) };
}

/** Restores masked secret values from the stored .env file. */
export async function restoreSecrets(name: string, env: string) {
	const stored = await readFile(path.join(projectDir(name), '.env'), 'utf8').catch(() => '');
	return unmaskEnv(env, stored);
}

/**
 * Validates a compose file with `docker compose config` before it is written.
 * `override`: the content of the override file, `undefined` = the one on disk.
 */
export async function validateCompose(
	dir: string,
	source: string,
	env?: string,
	override?: string
) {
	try {
		parseYaml(source);
		if (override) parseYaml(override);
	} catch (e) {
		return `YAML error: ${e instanceof Error ? e.message : e}`;
	}
	await mkdir(dir, { recursive: true });
	const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const tmp = path.join(dir, `.dockit-validate-${stamp}.yaml`);
	const tmpOverride = override ? path.join(dir, `.dockit-validate-${stamp}.override.yaml`) : null;
	const tmpEnv = env !== undefined ? path.join(dir, `.dockit-validate-${stamp}.env`) : null;
	const existing = override === undefined ? findOverrideFile(dir) : null;
	try {
		await writeFile(tmp, source);
		if (tmpOverride) await writeFile(tmpOverride, override!);
		if (tmpEnv) await writeFile(tmpEnv, env!);
		const args = ['compose', '--project-directory', dir, '-f', tmp];
		// with -f, docker compose doesn't pick up the override file on its own
		if (tmpOverride) args.push('-f', tmpOverride);
		else if (existing) args.push('-f', path.join(dir, existing));
		if (tmpEnv) args.push('--env-file', tmpEnv);
		args.push('config', '-q');
		const res = await run('docker', args, { cwd: dir, timeout: 30_000 });
		if (res.code !== 0) {
			let message = (res.stderr || res.stdout).replaceAll(tmp, 'compose.yaml');
			if (tmpOverride) message = message.replaceAll(tmpOverride, NEW_OVERRIDE_FILE);
			return message.trim();
		}
		return null;
	} finally {
		await unlink(tmp).catch(() => {});
		if (tmpOverride) await unlink(tmpOverride).catch(() => {});
		if (tmpEnv) await unlink(tmpEnv).catch(() => {});
	}
}

export const withNewline = (source: string) => (source.endsWith('\n') ? source : source + '\n');

/** Saves the compose file edited by the user (Configuration tab). */
export async function writeCompose(name: string, source: string) {
	const project = await loadProject(name);
	const file = project.composeFile ?? 'compose.yaml';
	await writeFile(path.join(project.dir, file), withNewline(source));
	syncTemplates();
}

/** The files Dockit changes in a project. */
export interface ProjectSources {
	compose: string;
	/** content of the override file, '' = there is none */
	override: string;
	config: DockitConfig;
}

export async function readSources(project: ProjectInfo): Promise<ProjectSources> {
	if (!project.composeFile) error(400, 'Project has no compose file');
	const { compose, override, config } = await readFiles(project.dir, project.composeFile);
	try {
		return { compose, override, config: parseConfigFile(config) };
	} catch (e) {
		error(400, (e as Error).message);
	}
}

export async function writeConfig(dir: string, config: DockitConfig) {
	const content = stringifyConfig(config);
	const file = path.join(dir, DOCKIT_FILE);
	if (content !== null) await writeFile(file, content);
	else await unlink(file).catch(() => {});
}

/** Writes the override file, one without content is removed. */
export async function writeOverride(dir: string, overrideFile: string | null, source: string) {
	const file = path.join(dir, overrideFile ?? NEW_OVERRIDE_FILE);
	if (hasContent(source)) await writeFile(file, withNewline(source));
	else if (overrideFile) await unlink(file).catch(() => {});
}

/**
 * Writes the files of a project that differ from `current` (from `readSources`).
 * The compose file belongs to the user: it is only written when a change asks for it.
 */
export async function saveSources(
	project: ProjectInfo,
	current: ProjectSources,
	next: Partial<ProjectSources>
) {
	if (!project.composeFile) error(400, 'Project has no compose file');
	if (next.config && stringifyConfig(next.config) !== stringifyConfig(current.config)) {
		await writeConfig(project.dir, next.config);
	}
	if (next.compose !== undefined && next.compose !== current.compose) {
		await writeFile(path.join(project.dir, project.composeFile), withNewline(next.compose));
	}
	if (next.override !== undefined && next.override !== current.override) {
		await writeOverride(project.dir, project.overrideFile, next.override);
	}
	syncTemplates();
}

/** Changes `dockit.json`. */
export async function updateConfig(name: string, edit: (config: DockitConfig) => DockitConfig) {
	const project = await loadProject(name);
	const current = await readSources(project);
	await saveSources(project, current, { config: edit(current.config) });
}

export async function writeEnv(name: string, source: string) {
	const dir = projectDir(name);
	await writeFile(
		path.join(dir, '.env'),
		source.endsWith('\n') || !source ? source : source + '\n',
		{
			mode: 0o600
		}
	);
}

export async function createProjectFolder(
	name: string,
	compose: string,
	env: string,
	files: Record<string, string> = {},
	config?: DockitConfig
) {
	const dir = projectDir(name);
	if (existsSync(dir)) {
		if (findComposeFile(dir)) error(409, `A project named ${name} already exists`);
	}
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, 'compose.yaml'), withNewline(compose));
	const content = config && stringifyConfig(config);
	if (content) await writeFile(path.join(dir, DOCKIT_FILE), content);
	if (env.trim()) await writeFile(path.join(dir, '.env'), env, { mode: 0o600 });
	for (const [rel, content] of Object.entries(files)) {
		const file = path.join(dir, rel);
		await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
		await writeFile(file, content, { mode: 0o600 });
	}
	syncTemplates();
}

/** Moves a project folder into `<root>/.trash` instead of deleting data. */
export async function trashProject(name: string) {
	const dir = projectDir(name);
	const trash = path.join(requireRoot(), '.trash');
	await mkdir(trash, { recursive: true });
	const target = path.join(trash, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
	await rename(dir, target);
	syncTemplates();
	return target;
}

/** Updates the project metadata in `dockit.json`, the template sections are kept. */
export async function writeMeta(name: string, meta: ProjectMeta) {
	await updateConfig(name, (config) => ({
		...config,
		description: meta.description || undefined,
		url: meta.url || undefined,
		icon: meta.icon || undefined,
		autoUpdate: meta.autoUpdate || undefined
	}));
}

/** Maps a container (via its compose labels) to a project folder name. */
export function projectNameFor(labels: { workingDir?: string; project?: string; name?: string }) {
	const root = getRoot();
	if (labels.workingDir && path.dirname(labels.workingDir) === root) {
		return path.basename(labels.workingDir);
	}
	return labels.project || labels.name || 'unknown';
}
