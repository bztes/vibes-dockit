import { containersOf } from './actions';
import {
	inspectContainers,
	listContainers,
	listImages,
	listVolumes,
	type Container
} from './docker';
import { parseLines, run, runOk } from './exec';
import { changes } from './monitor';
import { listProjects } from './projects';
import { getSelf } from './self';
import { blockers } from '../topology';

export interface NetworkInfo {
	id: string;
	name: string;
	driver: string;
	scope: string;
	internal: boolean;
	/** docker's own networks (bridge, host, none) */
	builtin: boolean;
	subnets: { subnet: string; gateway: string | null }[];
	/** compose project that created the network, if any */
	composeProject: string | null;
}

export interface ImageInfo {
	id: string;
	tags: string[];
	size: number;
	createdAt: string;
}

export interface VolumeInfo {
	name: string;
	driver: string;
	mountpoint: string;
	createdAt: string;
	/** compose project that created the volume, if any */
	composeProject: string | null;
	/** anonymous volumes are named by a random 64 character id */
	anonymous: boolean;
}

export interface NetworkEndpoint {
	network: string;
	/** without the prefix length */
	ip: string | null;
	/** names other containers on the network can use to reach this one */
	aliases: string[];
}

export interface Mount {
	type: string; // volume | bind | tmpfs | …
	/** volume name, null for other mount types */
	volume: string | null;
	source: string;
	destination: string;
	readOnly: boolean;
}

export interface TopologyContainer {
	id: string;
	name: string;
	image: string;
	imageId: string;
	service: string;
	state: string;
	/** human readable, e.g. "Up 3 hours (healthy)" */
	status: string;
	health: string;
	ports: string;
	/** dockit project folder name, null for containers dockit does not manage */
	project: string | null;
	/** compose project label (also set for compose projects outside the projects root) */
	composeProject: string | null;
	/** part of the project Dockit itself runs in */
	isSelf: boolean;
	/** name of the container whose network stack this one shares (`network_mode: service:…`) */
	sharesNetworkWith: string | null;
	/** runs with `network_mode: host` */
	hostNetwork: boolean;
	endpoints: NetworkEndpoint[];
	mounts: Mount[];
}

export interface Topology {
	containers: TopologyContainer[];
	images: ImageInfo[];
	volumes: VolumeInfo[];
	networks: NetworkInfo[];
}

const BUILTIN = new Set(['bridge', 'host', 'none']);

interface RawNetwork {
	id: string;
	name: string;
	driver: string;
	scope: string;
	internal: boolean;
	ipam: { Config: { Subnet?: string; Gateway?: string }[] | null } | null;
	labels: Record<string, string> | null;
}

async function inspectNetworks(): Promise<NetworkInfo[]> {
	const ids = (await runOk('docker', ['network', 'ls', '-q', '--no-trunc'])).stdout
		.split('\n')
		.filter(Boolean);
	if (ids.length === 0) return [];
	const fmt =
		'{"id":{{json .Id}},"name":{{json .Name}},"driver":{{json .Driver}},"scope":{{json .Scope}},' +
		'"internal":{{json .Internal}},"ipam":{{json .IPAM}},"labels":{{json .Labels}}}';
	// a network can vanish between ls and inspect, so don't fail on a non-zero exit
	const { stdout } = await run('docker', ['network', 'inspect', '--format', fmt, ...ids]);
	return parseLines<RawNetwork>(stdout).map((n) => ({
		id: n.id,
		name: n.name,
		driver: n.driver,
		scope: n.scope,
		internal: n.internal,
		builtin: BUILTIN.has(n.name),
		subnets: (n.ipam?.Config ?? [])
			.filter((c) => c.Subnet)
			.map((c) => ({ subnet: c.Subnet!, gateway: c.Gateway || null })),
		composeProject: n.labels?.['com.docker.compose.network']
			? (n.labels['com.docker.compose.project'] ?? null)
			: null
	}));
}

function sharedWith(mode: string, containers: Container[]) {
	if (!mode.startsWith('container:')) return null;
	const ref = mode.slice('container:'.length);
	const target = containers.find((c) => c.id === ref || c.id.startsWith(ref) || c.name === ref);
	return target?.name ?? ref.slice(0, 12);
}

let cache: { at: number; promise: Promise<Topology> } | undefined;
changes.on('resources', () => (cache = undefined));

/**
 * All containers, images, volumes and networks on the host and how they are connected.
 * Shared by every open view until the next docker change (or for a second).
 */
export function getTopology(): Promise<Topology> {
	if (cache && Date.now() - cache.at < 1000) return cache.promise;
	const promise = loadTopology();
	cache = { at: Date.now(), promise };
	promise.catch(() => (cache = undefined));
	return promise;
}

async function loadTopology(): Promise<Topology> {
	const [networks, [containers, inspected], images, volumes, projects] = await Promise.all([
		inspectNetworks(),
		listContainers().then(
			async (cs) => [cs, await inspectContainers(cs.map((c) => c.id))] as const
		),
		listImages(),
		listVolumes(),
		listProjects()
	]);
	const details = new Map(inspected.map((d) => [d.id, d]));

	const projectOf = new Map<string, string>();
	for (const p of projects)
		for (const c of containersOf(p, containers)) projectOf.set(c.id, p.name);
	const self = getSelf()?.project;

	return {
		networks: networks.sort(
			(a, b) => Number(a.builtin) - Number(b.builtin) || a.name.localeCompare(b.name)
		),
		images: images
			.map((i) => ({ id: i.id, tags: i.tags, size: i.size, createdAt: i.created }))
			.sort((a, b) => (a.tags[0] ?? '~').localeCompare(b.tags[0] ?? '~')),
		volumes: volumes
			.map((v) => ({
				name: v.name,
				driver: v.driver,
				mountpoint: v.mountpoint,
				createdAt: v.createdAt,
				composeProject: v.labels['com.docker.compose.project'] ?? null,
				anonymous: /^[0-9a-f]{64}$/.test(v.name)
			}))
			.sort((a, b) => Number(a.anonymous) - Number(b.anonymous) || a.name.localeCompare(b.name)),
		containers: containers
			.map((c) => {
				const d = details.get(c.id);
				const project = projectOf.get(c.id) ?? null;
				return {
					id: c.id,
					name: c.name,
					image: c.image,
					imageId: d?.imageId ?? '',
					service: c.service,
					state: c.state,
					status: c.status,
					health: c.health,
					ports: c.ports,
					project,
					composeProject: c.project || null,
					isSelf: !!self && project === self,
					sharesNetworkWith: sharedWith(d?.networkMode ?? '', containers),
					hostNetwork: d?.networkMode === 'host',
					endpoints: Object.entries(d?.networks ?? {}).map(([network, ep]) => ({
						network,
						ip: ep.IPAddress?.replace(/\/\d+$/, '') || null,
						aliases: [...new Set([...(ep.DNSNames ?? []), ...(ep.Aliases ?? [])])].filter(
							(a) => a !== c.name && !c.id.startsWith(a)
						)
					})),
					mounts: (d?.mounts ?? []).map((m) => ({
						type: m.Type,
						volume: m.Type === 'volume' ? (m.Name ?? null) : null,
						source: m.Source,
						destination: m.Destination,
						readOnly: !m.RW
					}))
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name))
	};
}

// ---------------------------------------------------------------------------
// removal

export type ObjectKind = 'container' | 'image' | 'volume' | 'network';

type Removable = {
	container: TopologyContainer;
	image: ImageInfo;
	volume: VolumeInfo;
	network: NetworkInfo;
};

const removal: {
	[K in ObjectKind]: {
		find: (t: Topology, id: string) => Removable[K] | undefined;
		/** what to pass to `docker <kind> rm` */
		args: (x: Removable[K]) => string[];
	};
} = {
	container: { find: (t, id) => t.containers.find((c) => c.id === id), args: (c) => [c.id] },
	// an image with several tags can only be removed by id with --force, so remove every tag instead
	image: {
		find: (t, id) => t.images.find((i) => i.id === id),
		args: (i) => (i.tags.length ? i.tags : [i.id])
	},
	volume: { find: (t, name) => t.volumes.find((v) => v.name === name), args: (v) => [v.name] },
	network: { find: (t, name) => t.networks.find((n) => n.name === name), args: (n) => [n.id] }
};

/** Removes a container, image, volume or network unless something still needs it. */
export async function removeObject<K extends ObjectKind>(
	kind: K,
	id: string
): Promise<Removable[K]> {
	const t = await getTopology();
	const { find, args } = removal[kind];
	const x = find(t, id);
	if (!x) throw new Error(`${kind[0].toUpperCase()}${kind.slice(1)} not found`);
	const blocked = (blockers[kind] as (x: Removable[K], t: Topology) => string | null)(x, t);
	if (blocked) throw new Error(blocked);
	const res = await run('docker', [kind, 'rm', ...args(x)]);
	if (res.code !== 0) throw new Error(res.stderr.trim() || `Could not remove ${kind}`);
	return x;
}
