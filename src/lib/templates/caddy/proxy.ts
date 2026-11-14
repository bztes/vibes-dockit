import { isMap, isScalar, isSeq, parseDocument, type Document, YAMLMap, YAMLSeq } from 'yaml';

/**
 * Reverse proxy routes are stored as caddy-docker-proxy labels on the services
 * of a compose file. The service joins the (external) caddy network, Caddy talks
 * to the container directly — no published ports needed.
 *
 *   labels:
 *     caddy: app.example.com, www.example.com
 *     caddy.reverse_proxy: "{{upstreams 8080}}"
 *
 * Several routes on one service use numbered labels (`caddy_0`, `caddy_1`, …).
 */
export interface ProxyRoute {
	service: string;
	port: number;
	domains: string[];
}

export interface ServiceProxy {
	service: string;
	routes: ProxyRoute[];
	/** has caddy labels Dockit does not understand → only editable in the compose file */
	custom: boolean;
	/** `network_mode` is set, the service can't join the caddy network */
	networkMode: string | null;
	/** container ports found in `ports` / `expose`, used as suggestions */
	ports: number[];
	/** published host ports (not needed anymore once a route exists) */
	published: string[];
}

const ADDRESS_KEY = /^caddy(?:_(\d+))?$/;
const UPSTREAM_KEY = /^caddy(?:_(\d+))?\.reverse_proxy$/;
const ANY_CADDY_KEY = /^caddy(?:_\d+)?(?:\.|$)/;
const UPSTREAM_VALUE = /^\{\{\s*upstreams\s+(\d{1,5})\s*\}\}$/;

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

type Labels = Record<string, string>;

function labelsOf(service: Record<string, unknown>): Labels {
	const raw = service.labels;
	const out: Labels = {};
	if (Array.isArray(raw)) {
		for (const entry of raw) {
			if (typeof entry !== 'string') continue;
			const i = entry.indexOf('=');
			if (i === -1) out[entry] = '';
			else out[entry.slice(0, i)] = entry.slice(i + 1);
		}
	} else if (raw && typeof raw === 'object') {
		for (const [k, v] of Object.entries(raw)) out[k] = v == null ? '' : String(v);
	}
	return out;
}

/** Container ports from `ports` and `expose` (best effort). */
function containerPorts(service: Record<string, unknown>) {
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

/** Reads the routes of every service. Accepts the parsed compose json. */
export function readProxy(json: Record<string, unknown>): ServiceProxy[] {
	const services = (json.services ?? {}) as Record<string, Record<string, unknown> | null>;
	return Object.entries(services).map(([name, s]) => {
		const service = s ?? {};
		const labels = labelsOf(service);
		const addresses = new Map<string, string>();
		const upstreams = new Map<string, number>();
		let custom = false;
		for (const [key, value] of Object.entries(labels)) {
			let m = key.match(ADDRESS_KEY);
			if (m) {
				addresses.set(m[1] ?? '', value);
				continue;
			}
			m = key.match(UPSTREAM_KEY);
			const port = value.trim().match(UPSTREAM_VALUE);
			if (m && port) {
				upstreams.set(m[1] ?? '', Number(port[1]));
				continue;
			}
			if (ANY_CADDY_KEY.test(key)) custom = true;
		}
		const routes: ProxyRoute[] = [];
		const ids = [...addresses.keys()].sort((a, b) => Number(a || -1) - Number(b || -1));
		for (const id of ids) {
			const port = upstreams.get(id);
			const domains = splitDomains(addresses.get(id)!);
			if (!port || domains.length === 0 || domains.some((d) => !DOMAIN_RE.test(d))) {
				custom = true;
				continue;
			}
			routes.push({ service: name, port, domains });
		}
		if ([...upstreams.keys()].some((id) => !addresses.has(id))) custom = true;
		return {
			service: name,
			routes,
			custom,
			networkMode: typeof service.network_mode === 'string' ? service.network_mode : null,
			...containerPorts(service)
		};
	});
}

/** All domains of a compose file (for links on the overview). */
export function readDomains(json: Record<string, unknown>) {
	return readProxy(json).flatMap((s) => s.routes.flatMap((r) => r.domains));
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

function setLabels(service: YAMLMap, doc: Document, remove: (key: string) => boolean, add: Labels) {
	let labels: unknown = service.get('labels', true);
	if (labels === undefined || labels === null || isScalar(labels)) {
		if (Object.keys(add).length === 0) {
			if (labels !== undefined) service.delete('labels');
			return;
		}
		labels = new YAMLMap();
		service.set('labels', labels);
	}
	if (isSeq(labels)) {
		labels.items = labels.items.filter((item) => {
			const entry = String(plain(item));
			return !remove(entry.split('=')[0]);
		});
		for (const [k, v] of Object.entries(add)) labels.add(doc.createNode(`${k}=${v}`));
	} else if (isMap(labels)) {
		labels.items = labels.items.filter((item) => !remove(String(plain(item.key))));
		for (const [k, v] of Object.entries(add)) labels.set(k, v);
	}
	if ((isSeq(labels) || isMap(labels)) && labels.items.length === 0) service.delete('labels');
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

/**
 * Writes the routes as labels into the compose source and attaches the routed
 * services to the caddy network. Comments and formatting are kept. Services
 * with `custom` caddy labels are left untouched.
 */
export function applyProxy(source: string, routes: ProxyRoute[], network: string): string {
	const doc = parseDocument(source);
	if (doc.errors.length) throw new Error(doc.errors[0].message);
	const json = (doc.toJS() ?? {}) as Record<string, unknown>;
	const current = readProxy(json);
	const services = doc.get('services');
	if (!isMap(services)) throw new Error('The compose file has no services');

	const key = networkKey(doc, network);

	for (const info of current) {
		const own = routes.filter((r) => r.service === info.service);
		if (info.custom) {
			if (own.length) throw new Error(`Service ${info.service} has custom caddy labels`);
			continue;
		}
		if (info.networkMode && own.length) {
			throw new Error(`Service ${info.service} uses network_mode: ${info.networkMode}`);
		}
		const node = services.get(info.service, true);
		if (!isMap(node)) {
			if (own.length) throw new Error(`Service ${info.service} has no configuration`);
			continue;
		}
		const add: Labels = {};
		own.forEach((r, i) => {
			const id = own.length === 1 ? 'caddy' : `caddy_${i}`;
			add[id] = r.domains.join(', ');
			add[`${id}.reverse_proxy`] = `{{upstreams ${r.port}}}`;
		});
		setLabels(node, doc, (k) => ADDRESS_KEY.test(k) || UPSTREAM_KEY.test(k), add);
		if (!info.networkMode) setNetwork(node, doc, key, own.length > 0);
	}

	const unknown = routes.find((r) => !current.some((s) => s.service === r.service));
	if (unknown) throw new Error(`Unknown service ${unknown.service}`);

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
