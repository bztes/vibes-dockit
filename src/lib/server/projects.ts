import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { isMap, parseDocument } from 'yaml';
import { PROJECTS_ROOT } from '$app/env/private';
import { run } from './exec';
import { getSelf } from './self';
import { maskEnv, unmaskEnv } from '#lib/env.js';
import { matchTemplate, syncTemplates, templateLinks } from './templates';

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

/** Light-weight parse of a compose file (no interpolation). */
export function parseCompose(source: string) {
	const doc = parseDocument(source);
	if (doc.errors.length) throw new Error(doc.errors[0].message);
	const json = (doc.toJS() ?? {}) as Record<string, unknown>;
	const services = Object.entries(
		(json.services ?? {}) as Record<string, { image?: unknown; build?: unknown } | null>
	).map(([name, s]) => ({
		name,
		image: typeof s?.image === 'string' ? s.image : null,
		build: s?.build !== undefined
	}));
	const x = (json['x-dockit'] ?? {}) as Record<string, unknown>;
	const meta: ProjectMeta = {
		description: typeof x.description === 'string' ? x.description : undefined,
		url: typeof x.url === 'string' ? x.url : undefined,
		autoUpdate: x.autoUpdate === true,
		icon: typeof x.icon === 'string' ? x.icon : undefined
	};
	return {
		name: typeof json.name === 'string' ? json.name : null,
		services,
		meta,
		links: templateLinks(json),
		template: matchTemplate(services)
	};
}

export async function loadProject(name: string): Promise<ProjectInfo> {
	const dir = projectDir(name);
	if (!existsSync(dir)) error(404, `Project ${name} not found`);
	return readProject(name, dir);
}

async function readProject(name: string, dir: string): Promise<ProjectInfo> {
	const composeFile = findComposeFile(dir);
	const info: ProjectInfo = {
		name,
		dir,
		composeFile,
		composeName: normalizeComposeName(name),
		meta: {},
		services: [],
		links: [],
		template: null,
		parseError: null,
		isSelf: getSelf()?.project === name
	};
	if (!composeFile) return info;
	try {
		const parsed = parseCompose(await readFile(path.join(dir, composeFile), 'utf8'));
		if (parsed.name) info.composeName = normalizeComposeName(parsed.name);
		info.services = parsed.services;
		info.meta = parsed.meta;
		info.links = parsed.links;
		info.template = parsed.template;
	} catch (e) {
		info.parseError = e instanceof Error ? e.message : String(e);
	}
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

/** Validates a compose file with `docker compose config` before it is written. */
export async function validateCompose(dir: string, source: string, env?: string) {
	try {
		parseCompose(source);
	} catch (e) {
		return `YAML error: ${e instanceof Error ? e.message : e}`;
	}
	await mkdir(dir, { recursive: true });
	const tmp = path.join(dir, `.dockit-validate-${Date.now()}.yaml`);
	const tmpEnv = env !== undefined ? path.join(dir, `.dockit-validate-${Date.now()}.env`) : null;
	try {
		await writeFile(tmp, source);
		if (tmpEnv) await writeFile(tmpEnv, env!);
		const args = ['compose', '--project-directory', dir, '-f', tmp];
		if (tmpEnv) args.push('--env-file', tmpEnv);
		args.push('config', '-q');
		const res = await run('docker', args, { cwd: dir, timeout: 30_000 });
		if (res.code !== 0) {
			return (res.stderr || res.stdout).replaceAll(tmp, 'compose.yaml').trim();
		}
		return null;
	} finally {
		await unlink(tmp).catch(() => {});
		if (tmpEnv) await unlink(tmpEnv).catch(() => {});
	}
}

export async function writeCompose(name: string, source: string) {
	const project = await loadProject(name);
	const file = project.composeFile ?? 'compose.yaml';
	await writeFile(path.join(project.dir, file), source.endsWith('\n') ? source : source + '\n');
	syncTemplates();
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
	files: Record<string, string> = {}
) {
	const dir = projectDir(name);
	if (existsSync(dir)) {
		if (findComposeFile(dir)) error(409, `A project named ${name} already exists`);
	}
	await mkdir(dir, { recursive: true });
	await writeFile(
		path.join(dir, 'compose.yaml'),
		compose.endsWith('\n') ? compose : compose + '\n'
	);
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

/** Updates the `x-dockit` block in the compose file while keeping comments/formatting. */
export async function writeMeta(name: string, meta: ProjectMeta) {
	const project = await loadProject(name);
	if (!project.composeFile) error(400, 'Project has no compose file');
	const file = path.join(project.dir, project.composeFile);
	const doc = parseDocument(await readFile(file, 'utf8'));
	const values: Record<keyof ProjectMeta, unknown> = {
		description: meta.description || undefined,
		url: meta.url || undefined,
		icon: meta.icon || undefined,
		autoUpdate: meta.autoUpdate || undefined
	};
	let x = doc.get('x-dockit', true);
	if (!isMap(x) && isMap(doc.contents) && Object.values(values).some((v) => v !== undefined)) {
		const had = doc.has('x-dockit');
		x = doc.createNode({});
		doc.set('x-dockit', x);
		// put the metadata block on top of the file
		if (!had) doc.contents.items.unshift(doc.contents.items.pop()!);
	}
	if (isMap(x)) {
		// updated in place: other keys of the block (e.g. the domains of the caddy template) and their formatting are kept
		for (const [key, value] of Object.entries(values)) {
			if (value === undefined) x.delete(key);
			else x.set(key, value);
		}
		if (x.items.length === 0) doc.delete('x-dockit');
	}
	await writeFile(file, doc.toString());
}

/** Maps a container (via its compose labels) to a project folder name. */
export function projectNameFor(labels: { workingDir?: string; project?: string; name?: string }) {
	const root = getRoot();
	if (labels.workingDir && path.dirname(labels.workingDir) === root) {
		return path.basename(labels.workingDir);
	}
	return labels.project || labels.name || 'unknown';
}
