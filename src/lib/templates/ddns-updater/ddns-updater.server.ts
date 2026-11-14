import { chown } from 'node:fs/promises';
import path from 'node:path';
import * as v from 'valibot';
import { projectDir } from '#lib/server/projects.js';
import { parseImageRef } from '#lib/server/docker.js';
import type { ServerTemplate } from '#lib/server/templates.js';
import { DDNS_CONFIG_FILE, ddnsFiles, parseConfig, type DdnsConfig } from './ddns-updater';

const DDNS_REPOSITORIES = ['qmcgaw/ddns-updater', 'qdm12/ddns-updater'];

const schema = v.pipe(
	v.object({ config: v.string() }),
	v.rawTransform(({ dataset, addIssue, NEVER }) => {
		const parsed = parseConfig(dataset.value.config);
		if (typeof parsed !== 'string') return parsed;
		addIssue({ message: parsed });
		return NEVER;
	})
);

/** ddns-updater runs as this user and has to read the config and write updates.json */
const DDNS_UID = 1000;

const ddnsTemplate: ServerTemplate<DdnsConfig> = {
	id: 'ddns-updater',
	schema,
	async create(config) {
		return ddnsFiles(config);
	},
	async afterCreate(name) {
		// as root (dockit in docker) the files would be unreadable for the container
		if (process.getuid?.() !== 0) return;
		const file = path.join(projectDir(name), DDNS_CONFIG_FILE);
		await chown(path.dirname(file), DDNS_UID, DDNS_UID);
		await chown(file, DDNS_UID, DDNS_UID);
	},
	matches: (services) =>
		services.some((s) => !!s.image && DDNS_REPOSITORIES.includes(parseImageRef(s.image).repository))
};

export default ddnsTemplate;
