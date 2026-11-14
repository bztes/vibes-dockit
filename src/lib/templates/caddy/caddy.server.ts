import { existsSync, watch, type FSWatcher } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { parse } from 'yaml';
import { containersOf } from '#lib/server/actions.js';
import { listContainers, parseImageRef, type Container } from '#lib/server/docker.js';
import { run } from '#lib/server/exec.js';
import {
	listProjects,
	loadProject,
	parseCompose,
	validateCompose,
	writeCompose,
	type ProjectInfo
} from '#lib/server/projects.js';
import type { ServerTemplate } from '#lib/server/templates.js';
import type { CaddyValues } from './index';
import {
	applyProxy,
	caddySites,
	domainUrl,
	duplicateDomain,
	mainCaddyfile,
	readDomains,
	readProxy,
	readRoutes,
	upstreamHost,
	type ConnectedService,
	type ProxyRoute,
	type SiteSource
} from './proxy';

/**
 * Caddy integration: the caddy project runs the official image with a
 * Caddyfile in `conf/`. The domains of all projects (`x-dockit.domains`) are
 * written to `conf/dockit.caddy` and applied with `caddy reload` — no
 * container has to be recreated when a domain changes. Routed services join
 * the shared caddy network, no published ports needed.
 */
export const CADDY_IMAGE = 'caddy:2-alpine';
const DEFAULT_NETWORK = 'caddy';
const CONF_DIR = 'conf';
const MAIN_FILE = 'Caddyfile';
const SITES_FILE = 'dockit.caddy';

/**
 * - ready / stopped: the caddy project of this template (running or not)
 * - missing: no such project — other Caddy containers are ordinary projects
 */
export type CaddyState = 'ready' | 'stopped' | 'missing';

export interface CaddyInfo {
	state: CaddyState;
	container: { id: string; name: string; image: string; state: string } | null;
	/** Dockit project that runs the caddy container (if it is in the projects folder) */
	project: string | null;
	/** folder of that project */
	dir: string | null;
	/** docker network the proxied services have to join */
	network: string;
	networkExists: boolean;
	/** Caddy rejected the last configuration (e.g. a mistake in the Caddyfile) */
	error: string | null;
}

/** official image, caddy-docker-proxy or a custom build — all occupy ports 80 and 443 */
const isPlainCaddy = (image: string) => parseImageRef(image).repository === 'library/caddy';

async function networkExists(name: string) {
	return (await run('docker', ['network', 'inspect', name])).code === 0;
}

async function readJson(project: ProjectInfo) {
	if (!project.composeFile) return null;
	try {
		const source = await readFile(path.join(project.dir, project.composeFile), 'utf8');
		return (parse(source) ?? {}) as Record<string, unknown>;
	} catch {
		return null;
	}
}

/** The external network of the caddy project's compose file. */
function composeNetwork(json: Record<string, unknown> | null) {
	const networks = (json?.networks ?? {}) as Record<string, Record<string, unknown> | null>;
	for (const [key, def] of Object.entries(networks)) {
		if (def?.external === true) return typeof def.name === 'string' ? def.name : key;
	}
	return DEFAULT_NETWORK;
}

/** A project of this template: plain caddy image and a Caddyfile in `conf/`. */
function isCaddyProject(project: ProjectInfo) {
	return (
		project.services.some((s) => !!s.image && isPlainCaddy(s.image)) &&
		existsSync(path.join(project.dir, CONF_DIR, MAIN_FILE))
	);
}

let cache: { at: number; promise: Promise<CaddyInfo> } | undefined;

export function invalidateCaddy() {
	cache = undefined;
}

/** `projects` skips listing them again when the caller already has them. */
export function getCaddy(projects?: ProjectInfo[]): Promise<CaddyInfo> {
	if (!projects && cache && Date.now() - cache.at < 3000) return cache.promise;
	const promise = detect(projects);
	cache = { at: Date.now(), promise };
	promise.catch(() => (cache = undefined));
	return promise;
}

async function detect(projects?: ProjectInfo[]): Promise<CaddyInfo> {
	const [containers, list] = await Promise.all([
		listContainers().catch(() => [] as Container[]),
		projects ?? listProjects()
	]);
	const own = list.find(isCaddyProject);
	if (own) {
		const candidates = containersOf(own, containers).filter((c) => isPlainCaddy(c.image));
		const container = candidates.find((c) => c.state === 'running') ?? candidates[0];
		const network = composeNetwork(await readJson(own));
		return {
			state: container?.state === 'running' ? 'ready' : 'stopped',
			container: container
				? { id: container.id, name: container.name, image: container.image, state: container.state }
				: null,
			project: own.name,
			dir: own.dir,
			network,
			networkExists: await networkExists(network),
			error: lastError
		};
	}

	return {
		state: 'missing',
		container: null,
		project: null,
		dir: null,
		network: DEFAULT_NETWORK,
		networkExists: await networkExists(DEFAULT_NETWORK),
		error: null
	};
}

export async function ensureNetwork(name: string, log?: (text: string) => void) {
	if (await networkExists(name)) return;
	log?.(`Creating docker network ${name}\n`);
	const res = await run('docker', ['network', 'create', name]);
	if (res.code !== 0 && !(await networkExists(name))) {
		throw new Error(res.stderr.trim() || `Could not create network ${name}`);
	}
	invalidateCaddy();
}

/** Before `docker compose up`: the external caddy network and the Caddyfile have to exist. */
async function prepareUp(source: string, log?: (text: string) => void) {
	let json: Record<string, unknown>;
	let isCaddy: boolean;
	try {
		json = (parse(source) ?? {}) as Record<string, unknown>;
		isCaddy = parseCompose(source).template === caddyTemplate.id;
	} catch {
		return;
	}
	if (isCaddy) {
		await ensureNetwork(composeNetwork(json), log);
		await syncCaddy();
	} else if (readRoutes(json).length) {
		await ensureNetwork((await getCaddy()).network, log);
	}
}

// ---------------------------------------------------------------------------
// applying the domains

/** what Caddy was reloaded with last (container id + config) */
let applied: string | null = null;
let lastError: string | null = null;

/** Manual changes in `conf/` (Files tab, ssh, …) are applied right away. */
let watcher: { dir: string; fsw: FSWatcher } | null = null;
let watchTimer: NodeJS.Timeout | undefined;

function watchConf(dir: string) {
	if (watcher?.dir === dir) return;
	watcher?.fsw.close();
	watcher = null;
	try {
		const fsw = watch(dir, (_event, file) => {
			// our own write of the generated file
			if (file === SITES_FILE) return;
			clearTimeout(watchTimer);
			watchTimer = setTimeout(() => void caddyTemplate.sync?.(), 500);
		});
		fsw.on('error', () => {
			fsw.close();
			if (watcher?.fsw === fsw) watcher = null;
		});
		watcher = { dir, fsw };
	} catch {
		/* the folder is created with the next sync */
	}
}

/** compose files edited outside of Dockit (git pull, ssh, …) */
let interval: NodeJS.Timeout | undefined;
function startInterval() {
	interval ??= setInterval(() => void caddyTemplate.sync?.(), 60_000);
	interval.unref?.();
}

async function writeIfChanged(file: string, content: string) {
	const old = await readFile(file, 'utf8').catch(() => null);
	if (old === content) return;
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, content);
}

/** Writes `conf/dockit.caddy` and reloads Caddy when the config changed. Returns an error. */
async function doSync(): Promise<string | null> {
	const projects = await listProjects();
	const caddy = await getCaddy(projects);
	const dir = caddy.dir;
	if (!dir) return null;
	const sources: SiteSource[] = (
		await Promise.all(
			projects
				.filter((p) => p.dir !== dir)
				.map(async (p) => {
					const json = await readJson(p);
					return json ? [{ project: p.name, composeName: p.composeName, json }] : [];
				})
		)
	).flat();
	const sites = caddySites(sources);
	await writeIfChanged(path.join(dir, CONF_DIR, SITES_FILE), sites);
	watchConf(path.join(dir, CONF_DIR));
	startInterval();
	if (caddy.state !== 'ready' || !caddy.container) return null;

	const main = await readFile(path.join(dir, CONF_DIR, MAIN_FILE), 'utf8').catch(() => '');
	const state = `${caddy.container.id}\n${main}\n${sites}`;
	if (state === applied) return lastError;
	const res = await run(
		'docker',
		[
			'exec',
			caddy.container.id,
			'caddy',
			'reload',
			'--config',
			`/etc/caddy/${MAIN_FILE}`,
			'--adapter',
			'caddyfile'
		],
		{ timeout: 60_000 }
	);
	if (res.code !== 0) {
		// remembered, so the same broken config isn't retried every minute
		applied = state;
		lastError = `Caddy could not load the configuration:\n${(res.stderr || res.stdout).trim()}`;
		invalidateCaddy();
		return lastError;
	}
	applied = state;
	if (lastError) invalidateCaddy();
	lastError = null;
	return null;
}

let chain: Promise<unknown> = Promise.resolve();
let pending: Promise<string | null> | null = null;

/** Applies the domains of all projects. Calls during a running sync are coalesced into one. */
export function syncCaddy(): Promise<string | null> {
	if (pending) return pending;
	const next = chain.then(() => {
		pending = null;
		return doSync();
	});
	pending = next;
	chain = next.catch(() => {});
	return next;
}

// ---------------------------------------------------------------------------
// the caddy project

export function caddyCompose(network: string) {
	return `x-dockit:
  description: Reverse proxy with automatic HTTPS. Domains are configured in each project.

services:
  caddy:
    image: ${CADDY_IMAGE}
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    networks:
      - ${network}
    volumes:
      # Caddyfile (yours) and dockit.caddy (generated from the domains of all projects)
      - ./${CONF_DIR}:/etc/caddy:ro
      - data:/data
      - config:/config

networks:
  ${network}:
    name: ${network}
    external: true

volumes:
  data:
  config:
`;
}

const caddyTemplate: ServerTemplate<CaddyValues> = {
	id: 'caddy',
	schema: v.object({
		email: v.optional(v.union([v.literal(''), v.pipe(v.string(), v.trim(), v.email())]), '')
	}),
	async unavailable() {
		const caddy = await getCaddy();
		return caddy.project ? `Caddy already runs in project ${caddy.project}` : null;
	},
	async create({ email }) {
		await ensureNetwork(DEFAULT_NETWORK);
		return {
			compose: caddyCompose(DEFAULT_NETWORK),
			files: {
				[`${CONF_DIR}/${MAIN_FILE}`]: mainCaddyfile(email || undefined),
				[`${CONF_DIR}/${SITES_FILE}`]: ''
			}
		};
	},
	async afterCreate() {
		invalidateCaddy();
		await syncCaddy();
	},
	async tabs(project) {
		const caddy = await getCaddy();
		if (!caddy.project || caddy.project === project.name) return [];
		return [{ id: 'domains', count: (await projectDomains(project)).length || undefined }];
	},
	beforeUp: prepareUp,
	async sync() {
		const problem = await syncCaddy();
		if (problem) console.error(`[dockit] ${problem}`);
	},
	matches: (services) => services.some((s) => !!s.image && isPlainCaddy(s.image)),
	links: (json) => readDomains(json).map(domainUrl)
};

export default caddyTemplate;

// ---------------------------------------------------------------------------
// routes of a project

/** Names of the containers attached to a docker network. */
async function attached(network: string) {
	const res = await run('docker', [
		'network',
		'inspect',
		'--format',
		'{{json .Containers}}',
		network
	]);
	if (res.code !== 0) return new Set<string>();
	const containers = (JSON.parse(res.stdout || 'null') ?? {}) as Record<string, { Name?: string }>;
	return new Set(Object.values(containers).flatMap((c) => (c.Name ? [c.Name] : [])));
}

export async function readProjectProxy(name: string) {
	const project = await loadProject(name);
	if (!project.composeFile) error(400, 'Project has no compose file');
	const source = await readFile(path.join(project.dir, project.composeFile), 'utf8');
	const caddy = await getCaddy();
	let services: ConnectedService[] = [];
	let parseError: string | null = null;
	try {
		const names = await attached(caddy.network);
		services = readProxy((parse(source) ?? {}) as Record<string, unknown>).map((s) => ({
			...s,
			connected: names.has(upstreamHost(project.composeName, s.service, s.containerName))
		}));
	} catch (e) {
		parseError = e instanceof Error ? e.message : String(e);
	}
	return { services, parseError, caddy };
}

async function projectDomains(project: ProjectInfo) {
	const json = await readJson(project);
	return json ? readDomains(json) : [];
}

/** Domains that are already used by another project. */
async function conflicts(name: string, domains: string[]) {
	const wanted = new Set(domains);
	const others = (await listProjects()).filter((p) => p.name !== name);
	const lists = await Promise.all(others.map(projectDomains));
	return others.flatMap((p, i) =>
		lists[i].filter((d) => wanted.has(d)).map((domain) => ({ domain, project: p.name }))
	);
}

/** Saves the routes and applies them right away. Returns an error. */
export async function saveProjectProxy(name: string, routes: ProxyRoute[]) {
	const project = await loadProject(name);
	if (!project.composeFile) error(400, 'Project has no compose file');
	const dup = duplicateDomain(routes);
	if (dup) return `${dup} is used more than once`;
	const taken = await conflicts(
		name,
		routes.flatMap((r) => r.domains)
	);
	if (taken.length) return `${taken[0].domain} is already used by project ${taken[0].project}`;

	const caddy = await getCaddy();
	if (!caddy.project) return 'There is no Caddy project to apply the domains.';
	const file = path.join(project.dir, project.composeFile);
	const source = await readFile(file, 'utf8');
	let next: string;
	try {
		next = applyProxy(source, routes, caddy.network);
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}
	if (next === source) return null;
	if (routes.length) await ensureNetwork(caddy.network);
	const problem = await validateCompose(project.dir, next);
	if (problem) return problem;
	await writeCompose(name, next);
	return syncCaddy();
}
