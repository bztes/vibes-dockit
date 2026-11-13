import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { parse } from 'yaml';
import { listContainers, parseImageRef, type Container } from './docker';
import { run } from './exec';
import {
	createProjectFolder,
	findComposeFile,
	listProjects,
	loadProject,
	projectDir,
	projectNameFor,
	validateCompose,
	writeCompose
} from './projects';
import { applyProxy, duplicateDomain, readProxy, type ProxyRoute } from '#lib/proxy.js';

/**
 * Caddy integration based on caddy-docker-proxy: Caddy watches the docker
 * socket and builds its config from container labels. Projects only need the
 * labels and a connection to the shared caddy network — no published ports.
 */
export const CADDY_IMAGE = 'lucaslorentz/caddy-docker-proxy:2.13-alpine';
export const CADDY_PROJECT = 'caddy';
const DEFAULT_NETWORK = 'caddy';
const IGNORED_NETWORKS = new Set(['bridge', 'host', 'none']);

export type CaddyState = 'ready' | 'stopped' | 'incompatible' | 'missing';

export interface CaddyInfo {
	state: CaddyState;
	container: { id: string; name: string; image: string; state: string } | null;
	/** Dockit project that runs the caddy container (if it is in the projects folder) */
	project: string | null;
	/** docker network the proxied services have to join */
	network: string;
	networkExists: boolean;
}

const isProxyImage = (image: string) =>
	parseImageRef(image).repository === 'lucaslorentz/caddy-docker-proxy';
const isPlainCaddy = (image: string) => parseImageRef(image).repository === 'library/caddy';

async function networkExists(name: string) {
	return (await run('docker', ['network', 'inspect', name])).code === 0;
}

/** The network caddy-docker-proxy uses to reach the upstream containers. */
async function ingressNetwork(container: Container) {
	const res = await run('docker', [
		'container',
		'inspect',
		'--format',
		'{"env":{{json .Config.Env}},"networks":{{json .NetworkSettings.Networks}}}',
		container.id
	]);
	if (res.code !== 0) return DEFAULT_NETWORK;
	const info = JSON.parse(res.stdout) as {
		env: string[] | null;
		networks: Record<string, unknown> | null;
	};
	const env = (info.env ?? []).find((e) => e.startsWith('CADDY_INGRESS_NETWORKS='));
	const fromEnv = env?.split('=')[1]?.split(',')[0]?.trim();
	if (fromEnv) return fromEnv;
	const attached = Object.keys(info.networks ?? {}).filter((n) => !IGNORED_NETWORKS.has(n));
	return attached.find((n) => n === DEFAULT_NETWORK) ?? attached[0] ?? DEFAULT_NETWORK;
}

let cache: { at: number; promise: Promise<CaddyInfo> } | undefined;

export function invalidateCaddy() {
	cache = undefined;
}

export function getCaddy(): Promise<CaddyInfo> {
	if (cache && Date.now() - cache.at < 3000) return cache.promise;
	const promise = detect();
	cache = { at: Date.now(), promise };
	promise.catch(() => (cache = undefined));
	return promise;
}

async function detect(): Promise<CaddyInfo> {
	const containers = await listContainers().catch(() => [] as Container[]);
	const running = (c: Container) => (c.state === 'running' ? 0 : 1);
	const proxy = containers
		.filter((c) => isProxyImage(c.image))
		.sort((a, b) => running(a) - running(b))[0];
	const plain = containers.find((c) => isPlainCaddy(c.image));
	const found = proxy ?? plain;
	const network = proxy ? await ingressNetwork(proxy) : DEFAULT_NETWORK;
	return {
		state: proxy
			? proxy.state === 'running'
				? 'ready'
				: 'stopped'
			: plain
				? 'incompatible'
				: 'missing',
		container: found
			? { id: found.id, name: found.name, image: found.image, state: found.state }
			: null,
		project: found?.workingDir ? projectNameFor(found) : null,
		network,
		networkExists: await networkExists(network)
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

/** Before `docker compose up`: the external caddy network has to exist. */
export async function ensureProjectNetwork(source: string, log?: (text: string) => void) {
	let json: Record<string, unknown>;
	try {
		json = (parse(source) ?? {}) as Record<string, unknown>;
	} catch {
		return;
	}
	if (!readProxy(json).some((s) => s.routes.length)) return;
	await ensureNetwork((await getCaddy()).network, log);
}

// ---------------------------------------------------------------------------
// the caddy project

export function caddyCompose(network: string, email?: string) {
	const labels = email ? `\n    labels:\n      # global options\n      caddy.email: ${email}` : '';
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
    environment:
      CADDY_INGRESS_NETWORKS: ${network}
    networks:
      - ${network}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - data:/data
      - config:/config${labels}

networks:
  ${network}:
    name: ${network}
    external: true

volumes:
  data:
  config:
`;
}

export async function createCaddyProject(email?: string) {
	const caddy = await getCaddy();
	if (caddy.state === 'ready' || caddy.state === 'stopped') {
		error(409, `Caddy is already running in container ${caddy.container?.name}`);
	}
	const dir = projectDir(CADDY_PROJECT);
	if (existsSync(dir) && findComposeFile(dir)) {
		error(409, `The folder ${CADDY_PROJECT} already contains a compose file`);
	}
	const compose = caddyCompose(DEFAULT_NETWORK, email);
	await ensureNetwork(DEFAULT_NETWORK);
	const problem = await validateCompose(dir, compose);
	if (problem) error(400, problem);
	await createProjectFolder(CADDY_PROJECT, compose, '');
	invalidateCaddy();
	return CADDY_PROJECT;
}

// ---------------------------------------------------------------------------
// routes of a project

export async function readProjectProxy(name: string) {
	const project = await loadProject(name);
	if (!project.composeFile) error(400, 'Project has no compose file');
	const source = await readFile(path.join(project.dir, project.composeFile), 'utf8');
	let services: ReturnType<typeof readProxy> = [];
	let parseError: string | null = null;
	try {
		services = readProxy((parse(source) ?? {}) as Record<string, unknown>);
	} catch (e) {
		parseError = e instanceof Error ? e.message : String(e);
	}
	return { services, parseError, caddy: await getCaddy() };
}

/** Domains that are already used by another project. */
async function conflicts(name: string, domains: string[]) {
	const wanted = new Set(domains);
	const found: { domain: string; project: string }[] = [];
	for (const p of await listProjects()) {
		if (p.name === name) continue;
		for (const d of p.domains) if (wanted.has(d)) found.push({ domain: d, project: p.name });
	}
	return found;
}

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
	if (caddy.state === 'incompatible' && routes.length) {
		return 'The running Caddy container does not read docker labels. Use caddy-docker-proxy.';
	}
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
	return null;
}
