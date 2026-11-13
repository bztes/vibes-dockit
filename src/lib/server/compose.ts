import { stat } from 'node:fs/promises';
import path from 'node:path';
import { run } from './exec';
import type { ProjectInfo } from './projects';

export interface ResolvedService {
	name: string;
	image: string | null;
	build: boolean;
	containerName: string | null;
}

const cache = new Map<string, { key: string; services: ResolvedService[] }>();

async function mtimeKey(dir: string, files: string[]) {
	const times = await Promise.all(
		files.map((f) =>
			stat(path.join(dir, f))
				.then((s) => s.mtimeMs)
				.catch(() => 0)
		)
	);
	return times.join('|');
}

/** Services with fully interpolated image names (via `docker compose config`). */
export async function resolveServices(project: ProjectInfo): Promise<ResolvedService[]> {
	if (!project.composeFile) return [];
	const key = await mtimeKey(project.dir, [project.composeFile, '.env']);
	const hit = cache.get(project.dir);
	if (hit && hit.key === key) return hit.services;

	const res = await run('docker', ['compose', 'config', '--format', 'json'], {
		cwd: project.dir,
		timeout: 30_000
	});
	let services: ResolvedService[];
	if (res.code === 0) {
		const json = JSON.parse(res.stdout) as {
			services?: Record<string, { image?: string; build?: unknown; container_name?: string }>;
		};
		services = Object.entries(json.services ?? {}).map(([name, s]) => ({
			name,
			image: s.image ?? null,
			build: s.build !== undefined,
			containerName: s.container_name ?? null
		}));
	} else {
		// fall back to the raw (not interpolated) file
		services = project.services.map((s) => ({ ...s, containerName: null }));
	}
	cache.set(project.dir, { key, services });
	return services;
}
