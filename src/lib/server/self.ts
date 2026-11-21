import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DOCKIT_SELF_PROJECT } from '$app/env/private';
import { run } from './exec';

/**
 * When running inside a compose project we detect our own container through the
 * docker socket so the UI can mark the project. Dockit can't recreate itself (it
 * would be killed half way), so docker actions on its own project are disabled.
 */
export interface SelfInfo {
	project: string; // folder name
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
	if (DOCKIT_SELF_PROJECT) {
		self = { project: DOCKIT_SELF_PROJECT };
	} else if (existsSync('/.dockerenv')) {
		for (const id of containerIdCandidates()) {
			const res = await run('docker', [
				'container',
				'inspect',
				'--format',
				'{{index .Config.Labels "com.docker.compose.project.working_dir"}}',
				id
			]);
			if (res.code !== 0) continue;
			const workingDir = res.stdout.trim();
			if (workingDir) self = { project: path.basename(workingDir) };
			break;
		}
	}
	if (self) console.log(`[dockit] running as project "${self.project}"`);
	return self;
}

const SOCKET = '/var/run/docker.sock';

/**
 * Host path of the docker socket, for containers that need it (e.g. rootless
 * docker: `/run/user/1000/docker.sock`). In a container, the source of the
 * mounted socket; otherwise the endpoint of the current docker context.
 */
export async function hostDockerSocket() {
	const res = await run('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
	const host = res.stdout.trim();
	const local = res.code === 0 && host.startsWith('unix://') ? host.slice(7) : SOCKET;
	if (!existsSync('/.dockerenv')) return local;
	for (const id of containerIdCandidates()) {
		const mount = await run('docker', [
			'container',
			'inspect',
			'--format',
			`{{range .Mounts}}{{if eq .Destination "${local}"}}{{.Source}}{{end}}{{end}}`,
			id
		]);
		if (mount.code === 0) return mount.stdout.trim() || local;
	}
	return local;
}
