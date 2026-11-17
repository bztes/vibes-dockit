import { shortId } from '#lib/format.js';
import type {
	ImageInfo,
	NetworkInfo,
	Topology,
	TopologyContainer,
	VolumeInfo
} from '#lib/server/topology.js';

/**
 * Three column layout: images on the left, containers (grouped by project) in the middle,
 * networks and volumes on the right. Rows are ordered with a few rounds of the barycenter
 * heuristic to keep edges short and crossings low, then every side node is placed next to the
 * containers it is connected to.
 */

const SIZE = {
	sideWidth: 180,
	groupWidth: 220,
	groupHeader: 34,
	groupPadding: 8,
	groupGap: 16,
	row: 40,
	rowGap: 6,
	node: 48,
	nodeGap: 10,
	minGap: 48,
	maxGap: 160
};

export type NodeKind = 'image' | 'network' | 'volume';
export type Selection = { kind: 'container' | NodeKind; id: string };

export type SideNode =
	| { kind: 'image'; id: string; image: ImageInfo }
	| { kind: 'network'; id: string; network: NetworkInfo }
	| { kind: 'volume'; id: string; volume: VolumeInfo };

export type LayoutNode = SideNode & {
	key: string;
	x: number;
	y: number;
	width: number;
	height: number;
};

export interface LayoutContainer {
	container: TopologyContainer;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface LayoutGroup {
	key: string;
	label: string;
	/** dockit project to link to */
	project: string | null;
	x: number;
	y: number;
	width: number;
	height: number;
	containers: LayoutContainer[];
}

export interface LayoutEdge {
	id: string;
	container: string;
	/** key of the image, network or volume node */
	node: string;
	kind: NodeKind;
	/** ip address for network edges */
	ip: string | null;
	/** container end */
	from: { x: number; y: number };
	/** image / network / volume end */
	to: { x: number; y: number };
	path: string;
}

export interface Layout {
	width: number;
	height: number;
	groups: LayoutGroup[];
	nodes: LayoutNode[];
	edges: LayoutEdge[];
}

export interface LayoutOptions {
	images?: boolean;
	networks?: boolean;
	volumes?: boolean;
	/** show bridge / host / none */
	builtin?: boolean;
	/** show images, networks and volumes no container uses */
	unused?: boolean;
	/** available width, the gaps between the columns grow to fill it */
	width?: number;
}

export const nodeKey = (kind: NodeKind | 'container', id: string) => `${kind}:${id}`;

const STANDALONE = '\0standalone';

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** stable sort by a weight, entries without a weight go last in their original order */
function sortByWeight<T>(items: T[], weight: (t: T) => number) {
	return items
		.map((t, i) => {
			const w = weight(t);
			return { t, w: Number.isNaN(w) ? Infinity : w, i };
		})
		.sort((a, b) => (a.w === b.w ? a.i - b.i : a.w - b.w))
		.map((e) => e.t);
}

interface Link {
	key: string;
	kind: NodeKind;
	ip: string | null;
}

export function layoutTopology(t: Topology, opts: LayoutOptions = {}): Layout {
	const { images = true, networks = true, volumes = true } = opts;

	// which side nodes are visible
	const usedImages = new Set(t.containers.map((c) => c.imageId));
	const usedNetworks = new Set(t.containers.flatMap((c) => c.endpoints.map((e) => e.network)));
	const usedVolumes = new Set(t.containers.flatMap((c) => c.mounts.map((m) => m.volume)));

	let left: SideNode[] = images
		? t.images
				.filter((i) => opts.unused || usedImages.has(i.id))
				.map((image) => ({ kind: 'image' as const, id: image.id, image }))
		: [];
	let right: SideNode[] = [
		...(networks
			? t.networks
					.filter((n) => (opts.builtin || !n.builtin) && (opts.unused || usedNetworks.has(n.name)))
					.map((network) => ({ kind: 'network' as const, id: network.name, network }))
			: []),
		...(volumes
			? t.volumes
					.filter((v) => opts.unused || usedVolumes.has(v.name))
					.map((volume) => ({ kind: 'volume' as const, id: volume.name, volume }))
			: [])
	];
	const visible = new Set([...left, ...right].map((n) => nodeKey(n.kind, n.id)));

	const linksOf = new Map<string, Link[]>();
	for (const c of t.containers) {
		const links: Link[] = [
			{ key: nodeKey('image', c.imageId), kind: 'image' as const, ip: null },
			...c.endpoints.map((e) => ({
				key: nodeKey('network', e.network),
				kind: 'network' as const,
				ip: e.ip
			})),
			...c.mounts
				.filter((m) => m.volume)
				.map((m) => ({ key: nodeKey('volume', m.volume!), kind: 'volume' as const, ip: null }))
		];
		// a volume can be mounted twice, keep one edge per node
		const unique = new Map(links.filter((l) => visible.has(l.key)).map((l) => [l.key, l]));
		linksOf.set(c.id, [...unique.values()]);
	}
	const containersOf = new Map<string, string[]>();
	for (const [id, links] of linksOf)
		for (const l of links) {
			let ids = containersOf.get(l.key);
			if (!ids) containersOf.set(l.key, (ids = []));
			ids.push(id);
		}

	// group containers by project
	const byKey = new Map<
		string,
		{ key: string; label: string; project: string | null; items: TopologyContainer[] }
	>();
	for (const c of t.containers) {
		const key = c.project ?? c.composeProject ?? STANDALONE;
		let g = byKey.get(key);
		if (!g) {
			g = {
				key,
				label: key === STANDALONE ? 'Standalone containers' : key,
				project: c.project,
				items: []
			};
			byKey.set(key, g);
		}
		g.items.push(c);
	}
	let groups = [...byKey.values()].sort(
		(a, b) =>
			Number(a.key === STANDALONE) - Number(b.key === STANDALONE) ||
			Number(!a.project) - Number(!b.project) ||
			a.label.localeCompare(b.label)
	);

	/** the middle column, groups stacked from the top */
	function placeGroups(x: number) {
		const out: LayoutGroup[] = [];
		let y = 0;
		for (const g of groups) {
			const containers = g.items.map((c, i) => ({
				container: c,
				x: SIZE.groupPadding,
				y: SIZE.groupHeader + i * (SIZE.row + SIZE.rowGap),
				width: SIZE.groupWidth - SIZE.groupPadding * 2,
				height: SIZE.row
			}));
			const height =
				SIZE.groupHeader +
				g.items.length * (SIZE.row + SIZE.rowGap) -
				SIZE.rowGap +
				SIZE.groupPadding;
			out.push({
				key: g.key,
				label: g.label,
				project: g.project,
				x,
				y,
				width: SIZE.groupWidth,
				height,
				containers
			});
			y += height + SIZE.groupGap;
		}
		return out;
	}

	// barycenter ordering
	let containerY = new Map<string, number>();
	const rank = new Map<string, number>();
	function placeContainers() {
		containerY = new Map(
			placeGroups(0).flatMap((g) =>
				g.containers.map((c) => [c.container.id, g.y + c.y + c.height / 2])
			)
		);
	}
	const centerOf = (key: string) =>
		mean((containersOf.get(key) ?? []).map((id) => containerY.get(id)!));
	function rankSide(side: SideNode[]) {
		const sorted = sortByWeight(side, (n) => centerOf(nodeKey(n.kind, n.id)));
		sorted.forEach((n, i) => rank.set(nodeKey(n.kind, n.id), i / Math.max(1, sorted.length)));
		return sorted;
	}
	function rankSides() {
		left = rankSide(left);
		right = rankSide(right);
	}
	const weightOf = (c: TopologyContainer) => mean(linksOf.get(c.id)!.map((l) => rank.get(l.key)!));

	for (let round = 0; round < 4; round++) {
		placeContainers();
		rankSides();
		for (const g of groups) g.items = sortByWeight(g.items, weightOf);
		groups = sortByWeight(groups, (g) =>
			mean(g.items.map(weightOf).filter((w) => !Number.isNaN(w)))
		);
	}
	placeContainers();
	rankSides();

	// columns
	const columns = (left.length ? 1 : 0) + (right.length ? 1 : 0);
	const fixed = SIZE.groupWidth + columns * SIZE.sideWidth;
	const gap = columns
		? Math.min(SIZE.maxGap, Math.max(SIZE.minGap, ((opts.width ?? 0) - fixed) / columns))
		: 0;
	const groupX = left.length ? SIZE.sideWidth + gap : 0;
	const rightX = groupX + SIZE.groupWidth + gap;

	const out = placeGroups(groupX);
	const last = out.at(-1);
	let height = last ? last.y + last.height : 0;

	// side columns: every node as close as possible to the center of its containers
	const nodes: LayoutNode[] = [];
	for (const [side, x] of [
		[left, 0],
		[right, rightX]
	] as const) {
		let floor = 0;
		for (const n of side) {
			const key = nodeKey(n.kind, n.id);
			const center = centerOf(key);
			const top = Math.max(floor, Number.isNaN(center) ? floor : center - SIZE.node / 2);
			nodes.push({ ...n, key, x, y: top, width: SIZE.sideWidth, height: SIZE.node });
			floor = top + SIZE.node + SIZE.nodeGap;
		}
		height = Math.max(height, floor - SIZE.nodeGap);
	}

	// edges
	const byNode = new Map(nodes.map((n) => [n.key, n]));
	const edges: LayoutEdge[] = [];
	for (const g of out) {
		for (const c of g.containers) {
			for (const l of linksOf.get(c.container.id)!) {
				const n = byNode.get(l.key)!;
				const toLeft = n.x < g.x;
				const x1 = g.x + c.x + (toLeft ? 0 : c.width);
				const y1 = g.y + c.y + c.height / 2;
				const x2 = toLeft ? n.x + n.width : n.x;
				const y2 = n.y + n.height / 2;
				const dx = (x2 - x1) / 2;
				edges.push({
					id: `${c.container.id}>${l.key}`,
					container: c.container.id,
					node: l.key,
					kind: l.kind,
					ip: l.ip,
					from: { x: x1, y: y1 },
					to: { x: x2, y: y2 },
					path: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
				});
			}
		}
	}

	return {
		width: right.length ? rightX + SIZE.sideWidth : groupX + SIZE.groupWidth,
		height,
		groups: out,
		nodes,
		edges
	};
}

/** published host ports, e.g. `0.0.0.0:8080->80/tcp, [::]:8080->80/tcp` → `['8080→80']` */
export function publishedPorts(ports: string) {
	const out = new Set<string>();
	for (const m of ports.matchAll(/:(\d+(?:-\d+)?)->(\d+(?:-\d+)?)\/(\w+)/g)) {
		out.add(`${m[1] === m[2] ? m[1] : `${m[1]}→${m[2]}`}${m[3] === 'udp' ? '/udp' : ''}`);
	}
	return [...out];
}

/** display name of an image: its first tag, or the short id */
export const imageName = (i: ImageInfo) => i.tags[0] ?? `<untagged> ${shortId(i.id)}`;

/** display name of a volume: anonymous volumes get a short id */
export const volumeName = (v: VolumeInfo) => (v.anonymous ? v.name.slice(0, 12) : v.name);

export type { ImageInfo, NetworkInfo, Topology, TopologyContainer, VolumeInfo };
