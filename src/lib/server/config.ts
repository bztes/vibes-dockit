import { readFileSync } from 'node:fs';
import { chmod, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from './db';
import type { SmtpSettings } from '#lib/notifications.js';

/**
 * App settings live in a plain json file next to the (disposable) database so
 * that nothing important is lost when the db is deleted.
 */
export interface AppConfig {
	/** 0 = disabled */
	updateCheckIntervalHours: number;
	/** remove the previous, now unused image after a successful update */
	pruneImagesAfterUpdate: boolean;
	/** global mail server for all email channels; channels themselves are per user (db) */
	smtp: SmtpSettings | null;
}

const file = path.join(dataDir, 'config.json');

const defaults: AppConfig = {
	updateCheckIntervalHours: 6,
	pruneImagesAfterUpdate: false,
	smtp: null
};

let cache: AppConfig | undefined;

export function getConfig(): AppConfig {
	if (cache) return cache;
	try {
		const raw = JSON.parse(readFileSync(file, 'utf8'));
		delete raw.projectsRoot; // moved to the PROJECTS_ROOT env var
		delete raw.notifications; // channels are per user now and live in the db
		cache = { ...defaults, ...raw };
	} catch {
		cache = structuredClone(defaults);
	}
	return cache!;
}

let writing = Promise.resolve();

export function updateConfig(fn: (config: AppConfig) => void) {
	const next = structuredClone(getConfig());
	fn(next);
	cache = next;
	writing = writing.then(async () => {
		const tmp = `${file}.tmp`;
		await writeFile(tmp, JSON.stringify(next, null, '\t'), { mode: 0o600 });
		await rename(tmp, file);
		await chmod(file, 0o600).catch(() => {});
	});
	return writing;
}
