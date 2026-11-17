import { describe, expect, it } from 'vitest';
import {
	layoutTopology,
	nodeKey,
	publishedPorts,
	type ImageInfo,
	type NetworkInfo,
	type Topology,
	type TopologyContainer,
	type VolumeInfo
} from './layout';
import { blockers } from '#lib/topology.js';

const net = (name: string, builtin = false): NetworkInfo => ({
	id: name,
	name,
	driver: 'bridge',
	scope: 'local',
	internal: false,
	builtin,
	subnets: [],
	composeProject: null
});

const img = (tag: string): ImageInfo => ({
	id: `sha256:${tag}`,
	tags: [tag],
	size: 1,
	createdAt: ''
});

const vol = (name: string): VolumeInfo => ({
	name,
	driver: 'local',
	mountpoint: '',
	createdAt: '',
	composeProject: null,
	anonymous: false
});

const ctr = (
	name: string,
	project: string | null,
	networks: string[],
	{ image = 'app', volumes = [] as string[], state = 'running' } = {}
): TopologyContainer => ({
	id: name,
	name,
	image,
	imageId: `sha256:${image}`,
	service: name,
	state,
	status: 'Up 1 hour',
	health: 'none',
	ports: '',
	project,
	composeProject: project,
	isSelf: false,
	sharesNetworkWith: null,
	hostNetwork: false,
	endpoints: networks.map((network) => ({ network, ip: null, aliases: [] })),
	mounts: volumes.map((volume) => ({
		type: 'volume',
		volume,
		source: '',
		destination: '/data',
		readOnly: false
	}))
});

const topology: Topology = {
	networks: [net('a_default'), net('b_default'), net('proxy'), net('unused'), net('bridge', true)],
	images: [img('app'), img('db'), img('old')],
	volumes: [vol('a_data'), vol('orphan')],
	containers: [
		ctr('a1', 'a', ['a_default', 'proxy']),
		ctr('a2', 'a', ['a_default'], { image: 'db', volumes: ['a_data'] }),
		ctr('b1', 'b', ['b_default', 'proxy']),
		ctr('lonely', null, ['bridge'], { state: 'exited' })
	]
};

const names = (l: ReturnType<typeof layoutTopology>, kind: string) =>
	l.nodes
		.filter((n) => n.kind === kind)
		.map((n) => n.id)
		.sort();

describe('layoutTopology', () => {
	it('connects containers to their image, networks and volumes', () => {
		const l = layoutTopology(topology);
		expect(l.groups.find((g) => g.key === 'a')!.containers).toHaveLength(2);
		expect(names(l, 'network')).toEqual(['a_default', 'b_default', 'proxy']);
		expect(names(l, 'image')).toEqual(['sha256:app', 'sha256:db']);
		expect(names(l, 'volume')).toEqual(['a_data']);
		// 4 image edges, 5 network edges (bridge is hidden), 1 volume edge
		expect(l.edges).toHaveLength(10);
	});

	it('shows built-in and unused objects on request', () => {
		const l = layoutTopology(topology, { builtin: true, unused: true });
		expect(names(l, 'network')).toHaveLength(5);
		expect(names(l, 'image')).toHaveLength(3);
		expect(names(l, 'volume')).toHaveLength(2);
		expect(l.edges).toHaveLength(11);
	});

	it('hides a kind completely', () => {
		const l = layoutTopology(topology, { images: false, volumes: false });
		expect(l.nodes.every((n) => n.kind === 'network')).toBe(true);
		expect(l.groups[0].x).toBe(0);
	});

	it('does not overlap nodes in a column', () => {
		const l = layoutTopology(topology, { builtin: true, unused: true });
		for (const list of [
			l.nodes.filter((n) => n.kind === 'image'),
			l.nodes.filter((n) => n.kind !== 'image'),
			l.groups
		]) {
			const sorted = [...list].sort((a, b) => a.y - b.y);
			for (let i = 1; i < sorted.length; i++) {
				expect(sorted[i].y).toBeGreaterThanOrEqual(sorted[i - 1].y + sorted[i - 1].height);
			}
		}
	});

	it('puts the edge ends on the container and the node', () => {
		const l = layoutTopology(topology);
		const group = l.groups.find((g) => g.key === 'b')!;
		const c = group.containers.find((c) => c.container.id === 'b1')!;
		const right = l.edges.find(
			(e) => e.container === 'b1' && e.node === nodeKey('network', 'proxy')
		)!;
		const net = l.nodes.find((n) => n.key === nodeKey('network', 'proxy'))!;
		expect(right.to).toEqual({ x: net.x, y: net.y + net.height / 2 });
		expect(right.from).toEqual({ x: group.x + c.x + c.width, y: group.y + c.y + c.height / 2 });

		const left = l.edges.find((e) => e.container === 'b1' && e.kind === 'image')!;
		const image = l.nodes.find((n) => n.key === left.node)!;
		expect(left.to).toEqual({ x: image.x + image.width, y: image.y + image.height / 2 });
		expect(left.from.x).toBe(group.x + c.x);
	});

	it('grows the gaps to the available width', () => {
		const narrow = layoutTopology(topology);
		const wide = layoutTopology(topology, { width: 1000 });
		expect(wide.width).toBeGreaterThan(narrow.width);
		expect(wide.width).toBeLessThanOrEqual(1000);
	});
});

describe('blockers', () => {
	it('only allows removing unused objects', () => {
		const [a1, , , lonely] = topology.containers;
		expect(blockers.container(a1)).toMatch(/Stop/);
		expect(blockers.container(lonely)).toBeNull();
		expect(blockers.image(img('app'), topology)).toMatch(/Used by 3 containers/);
		expect(blockers.image(img('old'), topology)).toBeNull();
		expect(blockers.volume(vol('a_data'), topology)).toMatch(/Mounted by 1 container/);
		expect(blockers.volume(vol('orphan'), topology)).toBeNull();
		expect(blockers.network(net('proxy'), topology)).toMatch(/2 containers are attached/);
		expect(blockers.network(net('unused'), topology)).toBeNull();
		expect(blockers.network(net('bridge', true), topology)).toMatch(/built-in/);
	});
});

describe('publishedPorts', () => {
	it('dedupes ipv4 and ipv6 bindings', () => {
		expect(publishedPorts('0.0.0.0:8080->80/tcp, [::]:8080->80/tcp, 0.0.0.0:443->443/udp')).toEqual(
			['8080→80', '443/udp']
		);
		expect(publishedPorts('80/tcp')).toEqual([]);
	});
});
