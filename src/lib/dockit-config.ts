import { isMap, parseDocument, YAMLMap, type Document } from 'yaml';

/**
 * Dockit never changes the compose file of a project:
 * - its own settings live in `dockit.json` next to it: the project metadata on
 *   top and one section per template, keyed by the template id
 *   (`{ "description": "…", "caddy": { "domains": […] }, "restic": { … } }`)
 * - changes to the compose setup (e.g. joining the caddy network) go into the
 *   compose override file, which `docker compose` merges on its own — the
 *   project keeps working without Dockit.
 *
 * Older projects are migrated when they are loaded, see `#lib/server/migrate`.
 */
export const DOCKIT_FILE = 'dockit.json';

/** In the order `docker compose` looks for them: only the first one found is used. */
export const OVERRIDE_FILES = [
	'compose.override.yml',
	'compose.override.yaml',
	'docker-compose.override.yml',
	'docker-compose.override.yaml'
];
/** created when a project has no override file yet */
export const NEW_OVERRIDE_FILE = 'compose.override.yaml';

export type Json = Record<string, unknown>;

export interface DockitConfig {
	description?: string;
	url?: string;
	icon?: string;
	autoUpdate?: boolean;
	/** template sections, keyed by template id */
	[section: string]: unknown;
}

export const isObject = (value: unknown): value is Json =>
	!!value && typeof value === 'object' && !Array.isArray(value);

/** Parses `dockit.json`. Throws when it is not a JSON object. */
export function parseConfig(source: string): DockitConfig {
	const value: unknown = source.trim() ? JSON.parse(source) : {};
	if (!isObject(value)) throw new Error(`${DOCKIT_FILE} is not a JSON object`);
	return value;
}

/** Content of `dockit.json`, `null` = nothing to store (the file is removed). */
export function stringifyConfig(config: DockitConfig): string | null {
	const clean = Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined));
	return Object.keys(clean).length ? JSON.stringify(clean, null, 2) + '\n' : null;
}

/** The settings of a template, `null` = none. */
export function getSection(config: DockitConfig, id: string): Json | null {
	const value = config[id];
	return isObject(value) ? value : null;
}

/** Sets (or removes with `null`) the settings of a template. */
export function setSection(config: DockitConfig, id: string, value: Json | null): DockitConfig {
	const next = { ...config };
	if (value) next[id] = value;
	else delete next[id];
	return next;
}

/**
 * Parses a compose (override) file as a YAML document to edit, an empty file is
 * an empty map. Throws on YAML errors and when it is not a map.
 */
export function parseYamlMap(source: string, what = 'The compose file') {
	const doc = parseDocument(source);
	if (doc.errors.length) throw new Error(doc.errors[0].message);
	if (doc.contents === null) doc.contents = new YAMLMap() as never;
	if (!isMap(doc.contents)) throw new Error(`${what} is not a YAML map`);
	return doc;
}

/** Content of an edited override file, '' = it defines nothing. */
export function overrideString(doc: Document) {
	return isMap(doc.contents) && doc.contents.items.length ? doc.toString() : '';
}

/** `KEY=value` → `[KEY, value]`, `KEY` → `[KEY, null]` */
export function splitKeyValue(entry: string): [string, string | null] {
	const i = entry.indexOf('=');
	return i === -1 ? [entry, null] : [entry.slice(0, i), entry.slice(i + 1)];
}

/** Whether a compose (override) file defines anything. */
export function hasContent(source: string) {
	const doc = parseDocument(source);
	if (doc.contents === null) return false;
	return !isMap(doc.contents) || doc.contents.items.length > 0;
}

// ---------------------------------------------------------------------------
// merging

/** replaced by the override, not merged (like `docker compose` does) */
const REPLACED = new Set(['command', 'entrypoint', 'test']);
/** lists of `KEY=value` */
const KEY_VALUE = new Set(['environment', 'labels', 'annotations', 'extra_hosts', 'sysctls']);

function toMap(list: unknown[], key: string | undefined): Json {
	return Object.fromEntries(
		list.map((item) => {
			const s = String(item);
			return key && KEY_VALUE.has(key) ? splitKeyValue(s) : [s, null];
		})
	);
}

function merge(a: unknown, b: unknown, key?: string): unknown {
	if (b === undefined) return a;
	if (a === undefined || a === null || (key && REPLACED.has(key))) return b;
	if (Array.isArray(a) && Array.isArray(b)) {
		const seen = new Set(a.map((v) => JSON.stringify(v)));
		return [...a, ...b.filter((v) => !seen.has(JSON.stringify(v)))];
	}
	// e.g. `networks: [default]` in one file and a map in the other
	if (Array.isArray(a) && isObject(b)) return merge(toMap(a, key), b, key);
	if (isObject(a) && Array.isArray(b)) return merge(a, toMap(b, key), key);
	if (isObject(a) && isObject(b)) {
		const out: Json = { ...a };
		for (const [k, v] of Object.entries(b)) out[k] = merge(a[k], v, k);
		return out;
	}
	return b;
}

/** The compose file with the override applied (close enough to `docker compose config`). */
export function mergeCompose(base: Json, override: Json | null): Json {
	return override ? (merge(base, override) as Json) : base;
}
