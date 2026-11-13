import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DOCKIT_SELF_PROJECT } from '$app/env/private';
import { run } from './exec';

/**
 * Dockit can manage itself. When running inside a compose project we detect our
 * own container through the docker socket so the UI can mark the project and
 * updates can be executed by a helper container (we can't recreate ourselves).
 */
export interface SelfInfo {
	project: string; // folder name
	containerId: string | null;
	imageId: string | null;
	workingDir: string | null;
}

let self: SelfInfo | null = null;

export function getSelf() {
	return self;
}

function containerIdCandidates() {
	const ids = new Set<string>();
	ids.add(os.hostname());
	try {
		// cgroup v1 / v2 / mountinfo heuristics
		for (const f of ['/proc/self/cgroup', '/proc/self/mountinfo']) {
			if (!existsSync(f)) continue;
			const m = readFileSync(f, 'utf8').match(/[0-9a-f]{64}/g);
			m?.forEach((id) => ids.add(id));
		}
	} catch {
		/* ignore */
	}
	return [...ids];
}

export async function detectSelf() {
	if (existsSync('/.dockerenv') || DOCKIT_SELF_PROJECT) {
		for (const id of containerIdCandidates()) {
			const res = await run('docker', [
				'container',
				'inspect',
				'--format',
				'{{.Id}}|{{.Image}}|{{index .Config.Labels "com.docker.compose.project.working_dir"}}',
				id
			]);
			if (res.code !== 0) continue;
			const [containerId, imageId, workingDir] = res.stdout.trim().split('|');
			self = {
				project: DOCKIT_SELF_PROJECT ?? (workingDir ? path.basename(workingDir) : ''),
				containerId,
				imageId,
				workingDir: workingDir || null
			};
			break;
		}
	}
	if (!self && DOCKIT_SELF_PROJECT) {
		self = { project: DOCKIT_SELF_PROJECT, containerId: null, imageId: null, workingDir: null };
	}
	if (self) console.log(`[dockit] running as project "${self.project}"`);
	return self;
}
