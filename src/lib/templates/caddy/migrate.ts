import { isMap } from 'yaml';
import { parseYamlMap, type Json } from '#lib/dockit-config.js';
import {
	NETWORK_KEYS,
	applyProxy,
	dropExternalNetwork,
	hasNetwork,
	networkKey,
	networksOf,
	readRoutes,
	servicesOf,
	serviceUsesNetwork,
	setNetwork
} from './proxy';

/** Docker name of the external network older Dockit versions attached `services` to, `null` = none. */
function legacyNetwork(compose: Json, services: string[]) {
	const own = servicesOf(compose);
	const [found] = Object.entries(networksOf(compose))
		.filter(
			([key, def]) => def?.external === true && services.every((s) => hasNetwork(own[s], key))
		)
		.sort(([a], [b]) => Number(NETWORK_KEYS.includes(b)) - Number(NETWORK_KEYS.includes(a)));
	if (!found) return null;
	const [key, def] = found;
	return typeof def?.name === 'string' ? def.name : key;
}

/**
 * Projects from before the override file: Dockit attached the routed services
 * to the caddy network in the compose file itself. Moves that into the
 * override file. Returns `null` when there is nothing to move.
 */
export function migrateNetworks(source: string, override: string, section: Json | null) {
	const services = [...new Set(readRoutes(section).map((r) => r.service))];
	if (!services.length) return null;
	const doc = parseYamlMap(source);
	const json = doc.toJS() as Json;
	const network = legacyNetwork(json, services);
	if (!network) return null;
	const map = doc.get('services', true);
	if (!isMap(map)) return null;
	const key = networkKey(json, network);
	for (const name of services) {
		const node = map.get(name, true);
		if (isMap(node)) setNetwork(node, doc, key, false, true);
	}
	if (!map.items.some((item) => serviceUsesNetwork(item.value, key))) dropExternalNetwork(doc, key);
	return {
		compose: doc.toString(),
		override: applyProxy(doc.toJS() as Json, override, services, network)
	};
}
