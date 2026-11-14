import { isMap, isScalar, isSeq, parseDocument, type Document, YAMLMap, YAMLSeq } from 'yaml';

/**
 * Reverse proxy routes are stored in the `x-dockit` block of a compose file.
 * Docker compose ignores `x-` fields, so changing a domain never recreates a
 * container — the caddy template turns the routes of all projects into a
 * Caddyfile and reloads Caddy. The routed services only join the (external)
 * caddy network once; Caddy reaches them by container name.
 *
 *   x-dockit:
 *     domains:
 *       - service: app
 *         port: 8080
 *         domains: [app.example.com, www.example.com]
 */
export interface ProxyRoute {
	service: string;
	port: number;
	domains: string[];
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

type Json = Record<string, unknown>;

function servicesOf(json: Json) {
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
	return { service: r.service, port, domains };
}

/** All valid routes in `x-dockit.domains`. */
export function readRoutes(json: Json): ProxyRoute[] {
	const x = (json['x-dockit'] ?? {}) as Json;
	const list = Array.isArray(x.domains) ? x.domains : [];
	return list.flatMap((r) => validRoute(r) ?? []);
}

/** Reads the routes of every service. Accepts the parsed compose json. */
export function readProxy(json: Json): ServiceProxy[] {
	const routes = readRoutes(json);
	return Object.entries(servicesOf(json)).map(([name, s]) => {
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

/** All domains of a compose file (for links on the overview). */
export function readDomains(json: Json) {
	return readRoutes(json).flatMap((r) => r.domains);
}

/** Container name compose gives the (first) container of a service. */
export function upstreamHost(composeName: string, service: string, containerName?: string | null) {
	return containerName || `${composeName}-${service}-1`;
}

// ---------------------------------------------------------------------------
// writing

function plain(node: unknown): unknown {
	return isScalar(node) ? node.value : node;
}

/** Key of the top-level network that points to the docker network `network`. */
function networkKey(doc: Document, network: string) {
	const networks = doc.get('networks');
	if (isMap(networks)) {
		for (const item of networks.items) {
			const key = String(plain(item.key));
			const value = item.value;
			const name = isMap(value) ? plain(value.get('name', true)) : undefined;
			if ((name ?? key) === network) return key;
		}
		for (const candidate of ['caddy', 'caddy_proxy', 'dockit_caddy']) {
			if (!networks.has(candidate)) return candidate;
		}
	}
	return 'caddy';
}

function setNetwork(service: YAMLMap, doc: Document, key: string, join: boolean) {
	const networks = service.get('networks', true);
	if (join) {
		if (networks === undefined || networks === null) {
			// without a `networks` key the service is only in `default`, keep it there
			const seq = new YAMLSeq();
			seq.add(doc.createNode('default'));
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
		if (rest.length === 0 || (rest.length === 1 && rest[0] === 'default')) {
			service.delete('networks');
		}
	} else if (isMap(networks)) {
		networks.delete(key);
		if (networks.items.length === 0) service.delete('networks');
	}
}

function serviceUsesNetwork(service: unknown, key: string) {
	if (!isMap(service)) return false;
	const networks = service.get('networks', true);
	if (isSeq(networks)) return networks.items.some((i) => plain(i) === key);
	if (isMap(networks)) return networks.has(key);
	return false;
}

/** Writes `x-dockit.domains`, keeps the other metadata. */
function setRoutes(doc: Document, routes: ProxyRoute[]) {
	let x = doc.get('x-dockit', true);
	if (!routes.length) {
		if (isMap(x)) {
			x.delete('domains');
			if (x.items.length === 0) doc.delete('x-dockit');
		}
		return;
	}
	if (!isMap(x)) {
		x = new YAMLMap();
		doc.set('x-dockit', x);
		// keep the metadata block on top of the file
		if (isMap(doc.contents)) doc.contents.items.unshift(doc.contents.items.pop()!);
	}
	const list = doc.createNode(
		routes.map((r) => ({ service: r.service, port: r.port, domains: r.domains }))
	) as YAMLSeq;
	// short domain lists read better inline
	for (const item of list.items) {
		const domains = isMap(item) ? item.get('domains', true) : null;
		if (isSeq(domains)) domains.flow = true;
	}
	(x as YAMLMap).set('domains', list);
}

/**
 * Writes the routes into `x-dockit.domains` and attaches the routed services to
 * the caddy network (detached when they lose their last route). Comments and
 * formatting are kept.
 */
export function applyProxy(source: string, routes: ProxyRoute[], network: string): string {
	const doc = parseDocument(source);
	if (doc.errors.length) throw new Error(doc.errors[0].message);
	const json = (doc.toJS() ?? {}) as Json;
	const current = readProxy(json);
	const services = doc.get('services');
	if (!isMap(services)) throw new Error('The compose file has no services');

	const unknown = routes.find((r) => !current.some((s) => s.service === r.service));
	if (unknown) throw new Error(`Unknown service ${unknown.service}`);

	const key = networkKey(doc, network);
	for (const info of current) {
		const routed = routes.some((r) => r.service === info.service);
		if (info.networkMode) {
			if (routed) throw new Error(`Service ${info.service} uses network_mode: ${info.networkMode}`);
			continue;
		}
		const node = services.get(info.service, true);
		if (!isMap(node)) {
			if (routed) throw new Error(`Service ${info.service} has no configuration`);
			continue;
		}
		setNetwork(node, doc, key, routed);
	}

	// sorted by service, in the order of the editor
	const order = current.map((s) => s.service);
	setRoutes(
		doc,
		[...routes].sort((a, b) => order.indexOf(a.service) - order.indexOf(b.service))
	);

	// top-level network definition
	const used = services.items.some((item) => serviceUsesNetwork(item.value, key));
	if (used) {
		let networks = doc.get('networks', true);
		if (!isMap(networks)) {
			networks = new YAMLMap();
			doc.set('networks', networks);
		}
		(networks as YAMLMap).set(key, doc.createNode({ name: network, external: true }));
	} else {
		const networks = doc.get('networks', true);
		if (isMap(networks)) {
			const def = networks.get(key, true);
			if (isMap(def) && plain(def.get('external', true)) === true) networks.delete(key);
			if (networks.items.length === 0) doc.delete('networks');
		}
	}
	return doc.toString();
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
	json: Json;
}

/** The generated part of the Caddyfile: one site block per route of every project. */
export function caddySites(sources: SiteSource[]) {
	const lines = [
		'# Generated by Dockit from the domains of all projects.',
		'# Changes are overwritten — edit the domains in Dockit or add sites to the Caddyfile.',
		''
	];
	const seen = new Set<string>();
	for (const { project, composeName, json } of [...sources].sort((a, b) =>
		a.project.localeCompare(b.project)
	)) {
		for (const service of readProxy(json)) {
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
