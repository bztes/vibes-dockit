import type {
	ImageInfo,
	NetworkInfo,
	Topology,
	TopologyContainer,
	VolumeInfo
} from './server/topology';

const count = (n: number) => `${n} container${n > 1 ? 's' : ''}`;
const first = (n: number) => `Remove ${n > 1 ? 'them' : 'it'} first.`;

/** Why an object can't be removed, or null when it can. Shared by the UI and the commands. */
export const blockers = {
	container(c: TopologyContainer) {
		if (c.isSelf) return 'Dockit can not remove its own containers.';
		if (c.state === 'running' || c.state === 'restarting' || c.state === 'paused')
			return 'Stop the container before removing it.';
		return null;
	},
	image(i: ImageInfo, t: Pick<Topology, 'containers'>) {
		const users = t.containers.filter((c) => c.imageId === i.id);
		return users.length ? `Used by ${count(users.length)}. ${first(users.length)}` : null;
	},
	volume(v: VolumeInfo, t: Pick<Topology, 'containers'>) {
		const users = t.containers.filter((c) => c.mounts.some((m) => m.volume === v.name));
		return users.length ? `Mounted by ${count(users.length)}. ${first(users.length)}` : null;
	},
	network(n: NetworkInfo, t: Pick<Topology, 'containers'>) {
		if (n.builtin) return 'Docker’s built-in networks can not be removed.';
		const users = t.containers.filter((c) => c.endpoints.some((e) => e.network === n.name));
		if (!users.length) return null;
		const are = users.length > 1 ? 'are' : 'is';
		return `${count(users.length)} ${are} attached. ${first(users.length)}`;
	}
};
