import { isMap, isScalar, isSeq, type Document, YAMLMap, YAMLSeq } from 'yaml';
import {
	isObject,
	mergeCompose,
	overrideString,
	parseYamlMap,
	type Json
} from '#lib/dockit-config.js';

/**
 * Reverse proxy routes are stored in the `caddy` section of a project's
 * `dockit.json`. Docker doesn't read it, so changing a domain never recreates
 * a container — the caddy template turns the routes of all projects into a
 * Caddyfile and reloads Caddy. The routed services only join the (external)
 * caddy network once, in the compose override file; Caddy reaches them by
 * container name.
 *
 *   "caddy": {
 *     "domains": [
 *       { "service": "app", "port": 8080, "domains": ["app.example.com", "www.example.com"],
 *         "export": "/certs" }   // optional, see below
 *     ]
 *   }
 *
 * `export` mounts the certificate folder of each domain from Caddy's data
 * volume into the service (read-only, `volume.subpath`, in the override file),
 * e.g. for services that terminate TLS themselves: `/certs/<domain>.crt` (full
 * chain) and `.key`. With several domains each gets its own folder,
 * `/certs/<domain>/<domain>.crt`. It is plain compose config: renewals by Caddy
 * show up right away, no Dockit involved. The files are owned by root (mode
 * 600) as Caddy writes them.
 */
export interface ProxyRoute {
	service: string;
	port: number;
	domains: string[];
	/** folder in the container the certificates are mounted to */
	export?: string;
}

export interface ServiceProxy {
	service: string;
	routes: ProxyRoute[];
	/** `network_mode` is set, the service can't join the caddy network */
	networkMode: string | null;
	/** container ports found in `ports` / `expose`, used as suggestions */
	ports: number[];
	/** published host ports (not needed anymore once a route exists) */
	published: string[];
	/** explicit `container_name` */
	containerName: string | null;
}

/** A service with its state on the caddy network. */
export type ConnectedService = ServiceProxy & { connected: boolean };

export const DOMAIN_RE =
	/^(?:https?:\/\/)?(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::\d{1,5})?$/;

export function normalizeDomain(domain: string) {
	return domain.trim().toLowerCase().replace(/\/+$/, '');
}

export function splitDomains(value: string) {
	return value
		.split(/[\s,]+/)
		.map(normalizeDomain)
		.filter(Boolean);
}

/** The link to open for a caddy site address. */
export function domainUrl(domain: string) {
	return /^https?:\/\//.test(domain) ? domain : `https://${domain.replace(/^\*\./, '')}`;
}

export function servicesOf(json: Json) {
	return (json.services ?? {}) as Record<string, Json | null>;
}

/** Container ports from `ports` and `expose` (best effort). */
function containerPorts(service: Json) {
	const ports = new Set<number>();
	const published: string[] = [];
	for (const p of Array.isArray(service.ports) ? service.ports : []) {
		if (typeof p === 'number') {
			ports.add(p);
		} else if (typeof p === 'string') {
			published.push(p);
			const target = p.split('/')[0].split(':').pop();
			const n = Number(target?.split('-')[0]);
			if (n) ports.add(n);
		} else if (p && typeof p === 'object' && 'target' in p) {
			published.push(`${(p as { published?: unknown }).published ?? ''}:${p.target}`);
			const n = Number(p.target);
			if (n) ports.add(n);
		}
	}
	for (const p of Array.isArray(service.expose) ? service.expose : []) {
		const n = Number(String(p).split('/')[0].split('-')[0]);
		if (n) ports.add(n);
	}
	return { ports: [...ports], published };
}

function validRoute(value: unknown): ProxyRoute | null {
	if (!value || typeof value !== 'object') return null;
	const r = value as Json;
	const port = Number(r.port);
	// a list holds one domain per entry, a string may hold several
	const domains = Array.isArray(r.domains)
		? r.domains.map((d) => normalizeDomain(String(d)))
		: typeof r.domains === 'string'
			? splitDomains(r.domains)
			: [];
	if (typeof r.service !== 'string' || !Number.isInteger(port) || port < 1 || port > 65535)
		return null;
	if (domains.length === 0 || domains.some((d) => !DOMAIN_RE.test(d))) return null;
	const exportPath = typeof r.export === 'string' ? normalizeExportTarget(r.export) : null;
	return { service: r.service, port, domains, ...(exportPath ? { export: exportPath } : {}) };
}

/** All valid routes of the caddy section of `dockit.json`. */
export function readRoutes(section: Json | null): ProxyRoute[] {
	const list = Array.isArray(section?.domains) ? section.domains : [];
	return list.flatMap((r) => validRoute(r) ?? []);
}

/** Reads the routes of every service of a (merged) compose file. */
export function readProxy(compose: Json, section: Json | null): ServiceProxy[] {
	const routes = readRoutes(section);
	return Object.entries(servicesOf(compose)).map(([name, s]) => {
		const service = s ?? {};
		return {
			service: name,
			routes: routes.filter((r) => r.service === name),
			networkMode: typeof service.network_mode === 'string' ? service.network_mode : null,
			containerName: typeof service.container_name === 'string' ? service.container_name : null,
			...containerPorts(service)
		};
	});
}

/** All domains of a project (for links on the overview). */
export function readDomains(section: Json | null) {
	return readRoutes(section).flatMap((r) => r.domains);
}

/** Container name compose gives the (first) container of a service. */
export function upstreamHost(composeName: string, service: string, containerName?: string | null) {
	return containerName || `${composeName}-${service}-1`;
}

// ---------------------------------------------------------------------------
// writing

export function plain(node: unknown): unknown {
	return isScalar(node) ? node.value : node;
}

/** Keys Dockit uses for the caddy network, in order of preference. */
export const NETWORK_KEYS = ['caddy', 'caddy_proxy', 'dockit_caddy'];

/** Top-level networks of a parsed compose file. */
export const networksOf = (compose: Json) =>
	(isObject(compose.networks) ? compose.networks : {}) as Record<string, Json | null>;

/** Key of the top-level network that points to the docker network `network`. */
export function networkKey(compose: Json, network: string) {
	const networks = networksOf(compose);
	for (const [key, value] of Object.entries(networks)) {
		if ((typeof value?.name === 'string' ? value.name : key) === network) return key;
	}
	return NETWORK_KEYS.find((candidate) => !(candidate in networks)) ?? 'caddy';
}

/** Whether a service of a parsed compose file is attached to the network `key`. */
export function hasNetwork(service: Json | null | undefined, key: string) {
	const networks = service?.networks;
	if (Array.isArray(networks)) return networks.includes(key);
	return isObject(networks) && key in networks;
}

/**
 * Adds or removes `key` in the networks of a service node.
 * `implicitDefault`: the service has no other networks, so it is in `default` —
 * a `networks` list has to name it to keep it there.
 */
export function setNetwork(
	service: YAMLMap,
	doc: Document,
	key: string,
	join: boolean,
	implicitDefault: boolean
) {
	const networks = service.get('networks', true);
	if (join) {
		if (networks === undefined || networks === null) {
			const seq = new YAMLSeq();
			if (implicitDefault) seq.add(doc.createNode('default'));
			seq.add(doc.createNode(key));
			service.set('networks', seq);
		} else if (isSeq(networks)) {
			if (!networks.items.some((i) => plain(i) === key)) networks.add(doc.createNode(key));
		} else if (isMap(networks)) {
			if (!networks.has(key)) networks.set(key, doc.createNode({}));
		}
		return;
	}
	if (isSeq(networks)) {
		networks.items = networks.items.filter((i) => plain(i) !== key);
		const rest = networks.items.map(plain);
		if (rest.length === 0 || (implicitDefault && rest.length === 1 && rest[0] === 'default')) {
			service.delete('networks');
		}
	} else if (isMap(networks)) {
		networks.delete(key);
		if (networks.items.length === 0) service.delete('networks');
	}
}

export function serviceUsesNetwork(service: unknown, key: string) {
	if (!isMap(service)) return false;
	const networks = service.get('networks', true);
	if (isSeq(networks)) return networks.items.some((i) => plain(i) === key);
	if (isMap(networks)) return networks.has(key);
	return false;
}

/** Removes the external definition `key` of `networks` / `volumes` (and the section once it is empty). */
function dropExternal(doc: Document, section: 'networks' | 'volumes', key: string) {
	const defs = doc.get(section, true);
	if (!isMap(defs)) return;
	const def = defs.get(key, true);
	if (isMap(def) && plain(def.get('external', true)) === true) defs.delete(key);
	if (defs.items.length === 0) doc.delete(section);
}

/** Adds the external definition `key` → `name` to `networks` / `volumes`. */
function setExternal(doc: Document, section: 'networks' | 'volumes', key: string, name: string) {
	let defs = doc.get(section, true);
	if (!isMap(defs)) {
		defs = new YAMLMap();
		doc.set(section, defs);
	}
	(defs as YAMLMap).set(key, doc.createNode({ name, external: true }));
}

/** Removes the external definition of the network `key` (and `networks` once it is empty). */
export const dropExternalNetwork = (doc: Document, key: string) =>
	dropExternal(doc, 'networks', key);

/** The caddy section of `dockit.json` with `routes`, in the order of the services. `null` = none. */
export function proxySection(section: Json | null, routes: ProxyRoute[], order: string[]) {
	const rest = { ...section };
	delete rest.domains;
	if (routes.length) {
		rest.domains = [...routes]
			.sort((a, b) => order.indexOf(a.service) - order.indexOf(b.service))
			.map((r) => ({
				service: r.service,
				port: r.port,
				domains: r.domains,
				...(r.export ? { export: r.export } : {})
			}));
	}
	return Object.keys(rest).length ? rest : null;
}

/**
 * Attaches the routed services to the caddy network in the override file and
 * detaches the others (only where the override attached them: the compose
 * file belongs to the user). With `certs` the certificate mounts of the
 * override are replaced by `certs.mounts`, without them they are left alone.
 * Returns the new override file, '' = empty. Comments and formatting are kept.
 */
export function applyProxy(
	compose: Json,
	override: string,
	routed: string[],
	network: string,
	certs?: { mounts: CertMount[]; store?: CertStore }
): string {
	const doc = parseYamlMap(override, 'The compose override file');
	const merged = mergeCompose(compose, (doc.toJS() ?? {}) as Json);
	const services = servicesOf(merged);
	const own = servicesOf(compose);

	const unknown = routed.find((s) => !(s in services));
	if (unknown) throw new Error(`Unknown service ${unknown}`);
	const mounts = certs?.mounts ?? [];
	const store = certs?.store;
	if (mounts.length && !store)
		throw new Error('Caddy has no data volume to mount certificates from');

	const key = networkKey(merged, network);
	const certKey = store ? volumeKey(merged, store.volume) : null;
	let map = doc.get('services', true);
	for (const [name, service] of Object.entries(services)) {
		const join = routed.includes(name);
		if (typeof service?.network_mode === 'string') {
			if (join) throw new Error(`Service ${name} uses network_mode: ${service.network_mode}`);
			continue;
		}
		const serviceMounts = mounts.filter((m) => m.service === name);
		// attached by the user
		const userNetwork = join && hasNetwork(own[name], key);
		const add = (join && !userNetwork) || serviceMounts.length > 0;
		if (add && !isMap(map)) {
			map = new YAMLMap();
			doc.set('services', map);
		}
		if (!isMap(map)) continue;
		const found = map.get(name, true);
		let node: YAMLMap;
		if (isMap(found)) {
			node = found;
		} else {
			if (!add) continue;
			node = new YAMLMap();
			map.set(name, node);
		}
		if (!userNetwork) setNetwork(node, doc, key, join, own[name]?.networks === undefined);
		if (certKey && store) setCertMounts(node, doc, certKey, serviceMounts, store);
		if (node.items.length === 0) map.delete(name);
	}
	if (isMap(map) && map.items.length === 0) doc.delete('services');

	// top-level network definition
	const used = isMap(map) && map.items.some((item) => serviceUsesNetwork(item.value, key));
	if (used && !(key in networksOf(compose))) setExternal(doc, 'networks', key, network);
	else dropExternal(doc, 'networks', key);

	// top-level definition of Caddy's data volume
	if (certKey && store) {
		const mounted = isMap(map) && map.items.some((item) => serviceUsesCerts(item.value, certKey));
		if (mounted && !(certKey in volumesOf(compose)))
			setExternal(doc, 'volumes', certKey, store.volume);
		else dropExternal(doc, 'volumes', certKey);
	}
	return overrideString(doc);
}

// ---------------------------------------------------------------------------
// exported certificates

/** Normalizes an absolute folder in the container, null when invalid. */
export function normalizeExportTarget(value: string) {
	const v = value.trim();
	if (!v.startsWith('/')) return null;
	const parts: string[] = [];
	for (const part of v.split('/')) {
		if (part === '' || part === '.') continue;
		if (part === '..') return null;
		parts.push(part);
	}
	return parts.length ? `/${parts.join('/')}` : null;
}

/**
 * Name of a domain in Caddy's certificate storage (folder and file names).
 * Null for addresses Caddy gets no certificate for.
 */
export function certName(domain: string) {
	if (/^http:\/\//.test(domain)) return null;
	const host = domain.replace(/^https:\/\//, '').replace(/:\d+$/, '');
	return host.replace(/^\*\./, 'wildcard_.');
}

export interface CertMount {
	service: string;
	/** name in Caddy's storage */
	name: string;
	/** folder in the container */
	target: string;
}

/** The certificate folders to mount for the routes with `export`. */
export function certMounts(routes: ProxyRoute[]): CertMount[] {
	return routes.flatMap((r) => {
		if (!r.export) return [];
		const names = [...new Set(r.domains.flatMap((d) => certName(d) ?? []))];
		return names.map((name) => ({
			service: r.service,
			name,
			target: names.length === 1 ? r.export! : `${r.export}/${name}`
		}));
	});
}

/** Caddy's data volume and where a certificate folder is inside of it. */
export interface CertStore {
	/** docker volume name */
	volume: string;
	/** path of a certificate folder in the volume */
	subpath: (name: string) => string;
}

/** Top-level volumes of a parsed compose file. */
const volumesOf = (compose: Json) =>
	(isObject(compose.volumes) ? compose.volumes : {}) as Record<string, Json | null>;

/** Key of the top-level volume that points to the docker volume `volume`. */
function volumeKey(compose: Json, volume: string) {
	const volumes = volumesOf(compose);
	for (const [key, value] of Object.entries(volumes)) {
		if (typeof value?.name === 'string' && value.name === volume) return key;
	}
	return ['caddy_data', 'dockit_caddy_data'].find((c) => !(c in volumes)) ?? 'caddy_data';
}

/** A certificate mount written by `applyProxy`. */
function isCertMount(item: unknown, key: string) {
	return (
		isMap(item) &&
		plain(item.get('source', true)) === key &&
		plain(item.get('type', true)) === 'volume'
	);
}

function setCertMounts(
	service: YAMLMap,
	doc: Document,
	key: string,
	mounts: CertMount[],
	store: CertStore
) {
	const current = service.get('volumes', true);
	let volumes: YAMLSeq | null = isSeq(current) ? current : null;
	if (volumes) volumes.items = volumes.items.filter((i) => !isCertMount(i, key));
	if (mounts.length && !volumes) service.set('volumes', (volumes = new YAMLSeq()));
	for (const m of mounts) {
		volumes!.add(
			doc.createNode({
				type: 'volume',
				source: key,
				target: m.target,
				read_only: true,
				volume: { subpath: store.subpath(m.name) }
			})
		);
	}
	if (volumes && volumes.items.length === 0) service.delete('volumes');
}

function serviceUsesCerts(service: unknown, key: string) {
	if (!isMap(service)) return false;
	const volumes = service.get('volumes', true);
	return isSeq(volumes) && volumes.items.some((i) => isCertMount(i, key));
}

/** Same domain used twice → returns it. */
export function duplicateDomain(routes: ProxyRoute[]) {
	const seen = new Set<string>();
	for (const d of routes.flatMap((r) => r.domains)) {
		if (seen.has(d)) return d;
		seen.add(d);
	}
	return null;
}

// ---------------------------------------------------------------------------
// Caddyfile

export interface SiteSource {
	/** project folder name */
	project: string;
	composeName: string;
	/** merged compose file */
	compose: Json;
	/** caddy section of `dockit.json` */
	section: Json | null;
}

/** The generated part of the Caddyfile: one site block per route of every project. */
export function caddySites(sources: SiteSource[]) {
	const lines = [
		'# Generated by Dockit from the domains of all projects.',
		'# Changes are overwritten — edit the domains in Dockit or add sites to the Caddyfile.',
		''
	];
	const seen = new Set<string>();
	for (const { project, composeName, compose, section } of [...sources].sort((a, b) =>
		a.project.localeCompare(b.project)
	)) {
		for (const service of readProxy(compose, section)) {
			if (service.networkMode) continue;
			for (const route of service.routes) {
				// a domain can only be served once, the first project wins
				const domains = route.domains.filter((d) => !seen.has(d));
				if (!domains.length) continue;
				domains.forEach((d) => seen.add(d));
				const host = upstreamHost(composeName, route.service, service.containerName);
				lines.push(
					`# ${project} / ${route.service}`,
					`${domains.join(', ')} {`,
					`\treverse_proxy ${host}:${route.port}`,
					'}',
					''
				);
			}
		}
	}
	return lines.join('\n');
}

/** The user owned main Caddyfile of a new caddy project. */
export function mainCaddyfile(email?: string) {
	const global = email ? `{\n\temail ${email}\n}\n\n` : '';
	return `${global}# Sites of all Dockit projects (see the Domains tab of each project)
import dockit.caddy

# Further sites can be added here, see https://caddyserver.com/docs/caddyfile
`;
}
