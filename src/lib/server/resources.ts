import { containersOf } from './actions';
import { resolveServices } from './compose';
import {
	inspectContainers,
	listContainers,
	listImages,
	listVolumes,
	parseImageRef,
	repoKey
} from './docker';
import { loadProject } from './projects';

export interface ProjectImage {
	id: string;
	tags: string[];
	size: number;
	created: string;
	/** used by any container on the host (running or stopped) */
	inUse: boolean;
	/** used by a container of this project */
	usedByProject: boolean;
	/** the image currently referenced by the compose file */
	current: boolean;
}

export interface ProjectVolume {
	name: string;
	driver: string;
	mountpoint: string;
	createdAt: string;
	inUse: boolean;
	usedBy: string[];
	external: boolean;
}

/** Images and volumes that belong to a project, with usage information. */
export async function getProjectResources(name: string) {
	const project = await loadProject(name);
	const [services, containers, images, volumes] = await Promise.all([
		resolveServices(project),
		listContainers(),
		listImages(),
		listVolumes()
	]);
	const details = await inspectContainers(containers.map((c) => c.id));
	const own = new Set(containersOf(project, containers).map((c) => c.id));

	const usedImages = new Set(details.map((d) => d.imageId));
	const projectImages = new Set(details.filter((d) => own.has(d.id)).map((d) => d.imageId));
	const refs = services.map((s) => s.image).filter((i): i is string => !!i);
	const repos = new Set(refs.map((r) => repoKey(r)));
	const currentRefs = new Set(refs.map((r) => `${repoKey(r)}:${parseImageRef(r).tag}`));

	const imgs: ProjectImage[] = images
		.filter((img) => {
			if (projectImages.has(img.id)) return true;
			const names = [...img.tags, ...img.digests.map((d) => d.split('@')[0])];
			return names.some((n) => repos.has(repoKey(n)));
		})
		.map((img) => ({
			id: img.id,
			tags: img.tags,
			size: img.size,
			created: img.created,
			inUse: usedImages.has(img.id),
			usedByProject: projectImages.has(img.id),
			current: img.tags.some((t) => currentRefs.has(`${repoKey(t)}:${parseImageRef(t).tag}`))
		}))
		.sort((a, b) => Number(b.current) - Number(a.current) || b.created.localeCompare(a.created));

	const volumeUsers = new Map<string, string[]>();
	for (const d of details) {
		for (const v of d.volumes) {
			volumeUsers.set(v, [...(volumeUsers.get(v) ?? []), d.name.replace(/^\//, '')]);
		}
	}
	const ownVolumeNames = new Set(details.filter((d) => own.has(d.id)).flatMap((d) => d.volumes));

	const vols: ProjectVolume[] = volumes
		.filter(
			(v) =>
				v.labels['com.docker.compose.project'] === project.composeName || ownVolumeNames.has(v.name)
		)
		.map((v) => ({
			name: v.name,
			driver: v.driver,
			mountpoint: v.mountpoint,
			createdAt: v.createdAt,
			inUse: volumeUsers.has(v.name),
			usedBy: volumeUsers.get(v.name) ?? [],
			external: v.labels['com.docker.compose.project'] !== project.composeName
		}));

	return { images: imgs, volumes: vols };
}
