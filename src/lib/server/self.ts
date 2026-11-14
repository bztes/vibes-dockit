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
	/** host path of the docker socket mounted into this container (differs for rootless docker) */
	dockerSocket: string | null;
}

let self: SelfInfo | null = null;

export function getSelf() {
	return self;
}

const SOCKET = '/var/run/docker.sock';

/** Host path of the docker socket, for bind mounts in containers dockit starts. */
export function hostDockerSocket() {
	return self?.dockerSocket ?? SOCKET;
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
				'{{.Id}}|{{.Image}}|{{index .Config.Labels "com.docker.compose.project.working_dir"}}|' +
					`{{range .Mounts}}{{if eq .Destination "${SOCKET}"}}{{.Source}}{{end}}{{end}}`,
				id
			]);
			if (res.code !== 0) continue;
			const [containerId, imageId, workingDir, dockerSocket] = res.stdout.trim().split('|');
			self = {
				project: DOCKIT_SELF_PROJECT ?? (workingDir ? path.basename(workingDir) : ''),
				containerId,
				imageId,
				workingDir: workingDir || null,
				dockerSocket: dockerSocket || null
			};
			break;
		}
	}
	if (!self && DOCKIT_SELF_PROJECT) {
		self = {
			project: DOCKIT_SELF_PROJECT,
			containerId: null,
			imageId: null,
			workingDir: null,
			dockerSocket: null
		};
	}
	if (self) console.log(`[dockit] running as project "${self.project}"`);
	return self;
}
