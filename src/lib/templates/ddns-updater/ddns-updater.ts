/**
 * Dynamic DNS based on ddns-updater. The user provides its JSON config, which
 * is written to `data/config.json` in the project folder. That folder is bind
 * mounted as the container's data dir, so the compose file contains no secrets.
 */
const DDNS_IMAGE = 'qmcgaw/ddns-updater:v2';
/** relative to the project folder */
export const DDNS_CONFIG_FILE = 'data/config.json';
export const DDNS_DOCS = 'https://github.com/qdm12/ddns-updater#configuration';

export interface DdnsValues {
	/** ddns-updater JSON config */
	config: string;
}

export const CONFIG_EXAMPLE = `{
  "settings": [
    {
      "provider": "cloudflare",
      "zone_identifier": "your-zone-id",
      "domain": "home.example.com",
      "ttl": 1,
      "token": "your-api-token",
      "ip_version": "ipv4"
    }
  ]
}`;

type Settings = Record<string, unknown> & { provider: string; domain: string };
export interface DdnsConfig {
	settings: Settings[];
}

/**
 * Parses a ddns-updater config: the full `{"settings": [...]}` object, the
 * settings array or a single entry. Returns an error message when invalid.
 */
export function parseConfig(input: string): DdnsConfig | string {
	if (!input.trim()) return 'Enter a config';
	let json: unknown;
	try {
		json = JSON.parse(input);
	} catch (e) {
		return `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
	}
	let list: unknown = [json];
	if (Array.isArray(json)) list = json;
	else if (json && typeof json === 'object' && 'settings' in json) list = json.settings;
	if (!Array.isArray(list) || !list.length) return 'The config needs at least one entry';
	for (const [i, entry] of list.entries()) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
			return `Entry ${i + 1} is not an object`;
		}
		for (const key of ['provider', 'domain']) {
			if (typeof entry[key] !== 'string' || !entry[key]) {
				return `Entry ${i + 1} needs a "${key}"`;
			}
		}
	}
	return { settings: list as Settings[] };
}

export function ddnsFiles(config: DdnsConfig) {
	const unique = (list: string[]) => [...new Set(list)].join(', ');
	const providers = unique(config.settings.map((s) => s.provider));
	const domains = unique(config.settings.map((s) => s.domain));
	const compose = `services:
  ddns-updater:
    image: ${DDNS_IMAGE}
    restart: unless-stopped
    volumes:
      # config in ${DDNS_CONFIG_FILE}, see ${DDNS_DOCS}
      - ./data:/updater/data
`;
	return {
		compose,
		config: { description: `Dynamic DNS via ${providers} for ${domains}` },
		files: { [DDNS_CONFIG_FILE]: JSON.stringify(config, null, 2) + '\n' }
	};
}
