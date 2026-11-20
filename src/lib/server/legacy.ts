import { isMap, isScalar, parseDocument } from 'yaml';
import { isObject, type DockitConfig } from '#lib/dockit-config.js';

/** Where projects from before `dockit.json` kept Dockit's settings. */
export const LEGACY_KEY = 'x-dockit';

import type { Json } from '#lib/dockit-config.js';

/** The settings from the `x-dockit` block of a compose file (older projects), `null` = none. */
export function legacyConfig(compose: Json | null): DockitConfig | null {
	const x = compose?.[LEGACY_KEY];
	if (!isObject(x)) return null;
	const { domains, restic, ...meta } = x;
	const config: DockitConfig = { ...meta };
	if (domains !== undefined) config.caddy = { domains };
	// `restic: true` (or an empty block) = backed up with the defaults
	if (restic !== undefined && restic !== null && restic !== false) {
		config.restic = isObject(restic) ? restic : {};
	}
	return config;
}

/** Removes the `x-dockit` block from a compose file, keeping comments and formatting. */
export function removeLegacyBlock(source: string): string {
	const doc = parseDocument(source);
	if (doc.errors.length || !isMap(doc.contents) || !doc.has(LEGACY_KEY)) return source;
	const items = doc.contents.items;
	const index = items.findIndex((p) => (isScalar(p.key) ? p.key.value : p.key) === LEGACY_KEY);
	// a comment on top of the file belongs to the first key: keep it on top
	const key = items[index]?.key;
	const comment = isScalar(key) ? key.commentBefore : undefined;
	doc.delete(LEGACY_KEY);
	if (comment && index === 0) {
		doc.commentBefore = doc.commentBefore ? `${doc.commentBefore}\n${comment}` : comment;
		const next = items[0]?.key;
		// the file comment is followed by a blank line already
		if (isScalar(next)) next.spaceBefore = false;
	}
	return doc.toString();
}
