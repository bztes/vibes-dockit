import { existsSync, watch, type FSWatcher } from 'node:fs';
import {
	mkdir,
	readdir,
	readFile,
	readlink,
	rmdir,
	symlink,
	unlink,
	writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { containersOf } from '#lib/server/actions.js';
import {
	inspectContainers,
	listContainers,
	parseImageRef,
	type Container
} from '#lib/server/docker.js';
import { run } from '#lib/server/exec.js';
import { getSection, setSection } from '#lib/dockit-config.js';
import {
	listProjects,
	loadProject,
	parseYaml,
	readSources,
	saveSources,
	validateCompose,
	type ProjectInfo
} from '#lib/server/projects.js';
import type { ServerTemplate } from '#lib/server/templates.js';
import type { CaddyValues } from './index';
import { migrateNetworks } from './migrate';
import {
	applyProxy,
	caddySites,
	certNames,
	domainUrl,
	duplicateDomain,
	mainCaddyfile,
	proxySection,
	readAddresses,
	readDomains,
	readProxy,
	readRoutes,
	routeAddresses,
	upstreamHost,
	type ConnectedService,
	type ProxyRoute,
	type SiteSource
} from './proxy';

/**
 * Caddy integration: the caddy project runs the official image with a
 * Caddyfile in `conf/`. The domains of all projects (`caddy.domains` of their
 * `dockit.json`) are
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

const caddySection = (project: ProjectInfo) => getSection(project.config, caddyTemplate.id);

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
		const network = composeNetwork(own.compose);
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
async function prepareUp(project: ProjectInfo, log?: (text: string) => void) {
	if (!project.compose) return;
	if (project.template === caddyTemplate.id) {
		await ensureNetwork(composeNetwork(project.compose), log);
		await syncCaddy();
	} else if (readRoutes(caddySection(project)).length) {
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
	const sources: SiteSource[] = projects.flatMap((p) =>
		p.dir !== dir && p.compose
			? [
					{
						project: p.name,
						composeName: p.composeName,
						compose: p.compose,
						section: caddySection(p)
					}
				]
			: []
	);
	const sites = caddySites(sources);
	await writeIfChanged(path.join(dir, CONF_DIR, SITES_FILE), sites);
	await linkCertificates(caddy, projects).catch((e) =>
		console.error('[dockit] Could not link the certificates:', e)
	);
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

// ---------------------------------------------------------------------------
// certificate links

/** where the official image keeps its data (`$XDG_DATA_HOME`) */
const DATA_DIR = '/data';
const CERT_DIR = 'caddy/certificates';
/** issuer folder of a certificate Caddy hasn't obtained yet */
const DEFAULT_ISSUER = 'acme-v02.api.letsencrypt.org-directory';
/** folder of a project with the links to its certificates */
const CERT_LINKS = 'certs';

/** Issuer folders of the certificates Caddy has: name → issuer of the newest one. */
async function certIssuers(caddy: CaddyInfo) {
	const found = new Map<string, { issuer: string; mtime: number }>();
	if (!caddy.container) return found;
	const res = await run('docker', [
		'exec',
		caddy.container.id,
		'find',
		`${DATA_DIR}/${CERT_DIR}`,
		'-type',
		'f',
		'-name',
		'*.crt',
		'-exec',
		'stat',
		'-c',
		'%Y %n',
		'{}',
		'+'
	]);
	if (res.code !== 0) return found;
	for (const line of res.stdout.split('\n')) {
		const m = /^(\d+) .+\/([^/]+)\/([^/]+)\/\3\.crt$/.exec(line.trim());
		if (!m) continue;
		const mtime = Number(m[1]);
		const prev = found.get(m[3]);
		if (!prev || mtime > prev.mtime) found.set(m[3], { issuer: m[2], mtime });
	}
	return found;
}

/** issuers found last, looked up again when a link is missing or after a while */
let issuerCache: { at: number; issuers: Map<string, { issuer: string }> } | null = null;
const ISSUER_TTL = 10 * 60_000;

async function knownIssuers(caddy: CaddyInfo, refresh: boolean) {
	if (!refresh && issuerCache && Date.now() - issuerCache.at < ISSUER_TTL)
		return issuerCache.issuers;
	// Caddy isn't running: keep what was found before
	if (caddy.state !== 'ready') return issuerCache?.issuers ?? new Map();
	issuerCache = { at: Date.now(), issuers: await certIssuers(caddy) };
	return issuerCache.issuers;
}

let rootCache: { container: string; root: string | null } | null = null;

/** Where Caddy's certificates are on the host: the source of the container's `/data` mount. */
async function certRoot(caddy: CaddyInfo) {
	const id = caddy.container?.id;
	if (!id) return null;
	if (rootCache?.container !== id) {
		const [details] = await inspectContainers([id]).catch(() => []);
		const data = details?.mounts.find((m) => m.Destination === DATA_DIR);
		rootCache = { container: id, root: data ? path.join(data.Source, CERT_DIR) : null };
	}
	return rootCache.root;
}

/**
 * Links `certs/<domain>` in the project folders to the certificate folders in
 * Caddy's data volume on the host (routes with `certs`) and removes the links
 * that aren't wanted anymore. Files of the user are left alone.
 */
async function linkCertificates(caddy: CaddyInfo, projects: ProjectInfo[]) {
	const entries = await Promise.all(
		projects.map(async (p) => {
			const dir = path.join(p.dir, CERT_LINKS);
			const found = await readdir(dir, { withFileTypes: true }).catch(() => []);
			return {
				dir,
				names: certNames(readRoutes(caddySection(p))),
				links: found.filter((e) => e.isSymbolicLink()).map((e) => e.name)
			};
		})
	);
	if (!entries.some((e) => e.names.length || e.links.length)) return;
	const root = await certRoot(caddy);
	if (!root) return;
	const missing = entries.some((e) => e.names.some((n) => !e.links.includes(n)));
	const issuers = entries.some((e) => e.names.length)
		? await knownIssuers(caddy, missing)
		: new Map<string, { issuer: string }>();

	for (const { dir, names, links } of entries) {
		// stale links of Dockit (pointing into Caddy's storage)
		for (const name of links.filter((l) => !names.includes(l))) {
			const link = path.join(dir, name);
			if ((await readlink(link)).startsWith(root + path.sep)) await unlink(link);
		}
		if (!names.length) {
			if (links.length) await rmdir(dir).catch(() => {});
			continue;
		}
		await mkdir(dir, { recursive: true });
		for (const name of names) {
			const link = path.join(dir, name);
			const issuer = issuers.get(name)?.issuer;
			if (links.includes(name)) {
				// an unknown issuer keeps the link as it is
				const target = issuer && path.join(root, issuer, name);
				if (!target || (await readlink(link)) === target) continue;
				await unlink(link);
				await symlink(target, link);
			} else {
				// EEXIST: a file of the user
				await symlink(path.join(root, issuer ?? DEFAULT_ISSUER, name), link).catch((e) => {
					if (e?.code !== 'EEXIST') throw e;
				});
			}
		}
	}
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
	return `services:
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
			config: {
				description: 'Reverse proxy with automatic HTTPS. Domains are configured in each project.'
			},
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
		const count = readDomains(caddySection(project)).length;
		return [{ id: 'domains', count: count || undefined }];
	},
	beforeUp: prepareUp,
	async sync() {
		const problem = await syncCaddy();
		if (problem) console.error(`[dockit] ${problem}`);
	},
	migrate: (sources) =>
		migrateNetworks(
			sources.compose,
			sources.override,
			getSection(sources.config, caddyTemplate.id)
		) ?? {},
	matches: (services) => services.some((s) => !!s.image && isPlainCaddy(s.image)),
	links: (section) => readDomains(section).map(domainUrl)
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
	const caddy = await getCaddy();
	let services: ConnectedService[] = [];
	let parseError = project.parseError;
	if (project.compose) {
		try {
			const names = await attached(caddy.network);
			services = readProxy(project.compose, caddySection(project)).map((s) => ({
				...s,
				connected: names.has(upstreamHost(project.composeName, s.service, s.containerName))
			}));
		} catch (e) {
			parseError = e instanceof Error ? e.message : String(e);
		}
	}
	return { services, parseError, caddy };
}

const projectAddresses = (project: ProjectInfo) => readAddresses(caddySection(project));

/** Domains that are already used by another project. */
async function conflicts(name: string, domains: string[]) {
	const wanted = new Set(domains);
	const others = (await listProjects()).filter((p) => p.name !== name);
	return others.flatMap((p) =>
		projectAddresses(p)
			.filter((d) => wanted.has(d))
			.map((domain) => ({ domain, project: p.name }))
	);
}

/**
 * Saves the routes to `dockit.json`, attaches the routed services to the caddy
 * network in the override file and applies the routes right away. Returns an
 * error.
 */
export async function saveProjectProxy(name: string, routes: ProxyRoute[]) {
	const project = await loadProject(name);
	if (!project.composeFile) error(400, 'Project has no compose file');
	const dup = duplicateDomain(routes);
	if (dup) return `${dup} is used more than once`;
	const taken = await conflicts(name, routes.flatMap(routeAddresses));
	if (taken.length) return `${taken[0].domain} is already used by project ${taken[0].project}`;

	const caddy = await getCaddy();
	if (!caddy.project) return 'There is no Caddy project to apply the domains.';
	const current = await readSources(project);
	const section = getSection(current.config, caddyTemplate.id);
	let override: string;
	let config: typeof current.config;
	try {
		override = applyProxy(
			parseYaml(current.compose),
			current.override,
			routes.map((r) => r.service),
			caddy.network
		);
		const order = Object.keys((project.compose?.services ?? {}) as object);
		config = setSection(current.config, caddyTemplate.id, proxySection(section, routes, order));
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}
	const unchanged =
		override === current.override && JSON.stringify(config) === JSON.stringify(current.config);
	if (unchanged) return null;
	if (routes.length) await ensureNetwork(caddy.network);
	const problem = await validateCompose(project.dir, current.compose, undefined, override);
	if (problem) return problem;
	await saveSources(project, current, { override, config });
	return syncCaddy();
}
