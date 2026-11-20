import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DOCKIT_FILE } from '#lib/dockit-config.js';
import { legacyConfig, removeLegacyBlock } from './legacy';
import {
	findOverrideFile,
	parseYaml,
	readOptional,
	validateCompose,
	withNewline,
	writeConfig,
	writeOverride
} from './projects';
import { migrateTemplates } from './templates';

const migrations = new Map<string, Promise<void>>();

/**
 * Older projects kept Dockit's settings in the `x-dockit` block of the compose
 * file and its changes in the compose file itself. When such a project is
 * loaded, the block moves to `dockit.json` and the templates move their
 * changes into the override file. Runs once per project.
 */
export function migrateProject(name: string, dir: string, composeFile: string, source: string) {
	if (existsSync(path.join(dir, DOCKIT_FILE))) return;
	let running = migrations.get(dir);
	if (!running) {
		running = migrate(name, dir, composeFile, source)
			.catch((e) => console.error(`[dockit] could not migrate project ${name}`, e))
			.finally(() => migrations.delete(dir));
		migrations.set(dir, running);
	}
	return running;
}

async function migrate(name: string, dir: string, composeFile: string, source: string) {
	const config = legacyConfig(parseYaml(source));
	if (!config) return;
	const overrideFile = findOverrideFile(dir);
	const override = overrideFile ? ((await readOptional(path.join(dir, overrideFile))) ?? '') : '';
	const compose = removeLegacyBlock(source);
	let next = migrateTemplates({ compose, override, config });
	if (next.compose !== compose || next.override !== override) {
		const problem = await validateCompose(dir, next.compose, undefined, next.override);
		if (problem) {
			console.error(
				`[dockit] project ${name}: template changes stay in ${composeFile}: ${problem}`
			);
			next = { compose, override, config };
		}
	}
	await writeConfig(dir, next.config);
	await writeFile(path.join(dir, composeFile), withNewline(next.compose));
	if (next.override !== override) await writeOverride(dir, overrideFile, next.override);
	console.log(
		`[dockit] project ${name}: moved the x-dockit block of ${composeFile} to ${DOCKIT_FILE}`
	);
}
