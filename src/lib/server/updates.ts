import { and, eq, notInArray } from 'drizzle-orm';
import { db } from './db';
import { updateCheck, type UpdateCheck } from './db/schema';
import { inspectImage, localDigestFor, parseImageRef } from './docker';
import { resolveServices } from './compose';
import { listProjects, loadProject, type ProjectInfo } from './projects';
import { getRemoteDigest } from './registry';
import { notify } from './notify';

export async function getUpdateChecks(project?: string): Promise<UpdateCheck[]> {
	return project
		? db.select().from(updateCheck).where(eq(updateCheck.project, project))
		: db.select().from(updateCheck);
}

async function checkImage(image: string) {
	const ref = parseImageRef(image);
	if (ref.digest)
		return { status: 'pinned' as const, localDigest: ref.digest, remoteDigest: ref.digest };
	const local = await inspectImage(image);
	const localDigest = local ? localDigestFor(local, image) : null;
	const remoteDigest = await getRemoteDigest(ref);
	if (!local) {
		// not pulled yet → pulling would get something new
		return { status: 'available' as const, localDigest: null, remoteDigest };
	}
	if (!localDigest) {
		// built locally or loaded from a tarball, we can't compare
		return { status: 'unknown' as const, localDigest: null, remoteDigest };
	}
	const upToDate = local.digests.some((d) => d.endsWith(`@${remoteDigest}`));
	return {
		status: upToDate ? ('up-to-date' as const) : ('available' as const),
		localDigest,
		remoteDigest
	};
}

/** Checks all images of a project and stores the result. Returns images with a new update. */
export async function checkProjectUpdates(project: ProjectInfo, { silent = false } = {}) {
	const services = await resolveServices(project);
	const images = new Map<string, string[]>();
	for (const s of services) {
		if (!s.image || s.build) continue;
		images.set(s.image, [...(images.get(s.image) ?? []), s.name]);
	}

	const existing = new Map((await getUpdateChecks(project.name)).map((r) => [r.image, r]));
	const fresh: UpdateCheck[] = [];

	for (const [image, svc] of images) {
		const id = `${project.name}|${image}`;
		const prev = existing.get(image);
		let row: UpdateCheck;
		try {
			const result = await checkImage(image);
			row = {
				id,
				project: project.name,
				image,
				services: svc.join(','),
				...result,
				notifiedDigest: prev?.notifiedDigest ?? null,
				error: null,
				checkedAt: new Date()
			};
		} catch (e) {
			row = {
				id,
				project: project.name,
				image,
				services: svc.join(','),
				status: 'error',
				localDigest: prev?.localDigest ?? null,
				remoteDigest: prev?.remoteDigest ?? null,
				notifiedDigest: prev?.notifiedDigest ?? null,
				error: e instanceof Error ? e.message : String(e),
				checkedAt: new Date()
			};
		}
		if (
			row.status === 'available' &&
			row.localDigest &&
			row.remoteDigest &&
			row.notifiedDigest !== row.remoteDigest
		) {
			fresh.push(row);
			row.notifiedDigest = row.remoteDigest;
		}
		await db
			.insert(updateCheck)
			.values(row)
			.onConflictDoUpdate({ target: updateCheck.id, set: row });
	}

	// forget images that are no longer part of the project
	const keep = [...images.keys()];
	await db
		.delete(updateCheck)
		.where(
			keep.length
				? and(eq(updateCheck.project, project.name), notInArray(updateCheck.image, keep))
				: eq(updateCheck.project, project.name)
		);

	if (fresh.length && !silent) {
		await notify({
			type: 'update_available',
			project: project.name,
			title: `Update available for ${project.name}`,
			message: fresh.map((r) => `• ${r.image} (${r.services})`).join('\n')
		});
	}
	return fresh;
}

let running: Promise<void> | null = null;
export let lastFullCheck: Date | null = null;

/** Checks every project. `onFresh` is called for projects with new updates (auto update). */
export function checkAllUpdates(onFresh?: (project: ProjectInfo) => void) {
	running ??= (async () => {
		try {
			for (const project of await listProjects()) {
				try {
					const fresh = await checkProjectUpdates(project);
					if (fresh.length) onFresh?.(project);
				} catch (e) {
					console.error(`[dockit] update check for ${project.name} failed`, e);
				}
			}
			lastFullCheck = new Date();
		} finally {
			running = null;
		}
	})();
	return running;
}

export async function checkUpdatesByName(name: string) {
	return checkProjectUpdates(await loadProject(name));
}
