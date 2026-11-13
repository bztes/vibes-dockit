import { parseLines, run, runOk } from './exec';

export interface Container {
	id: string;
	name: string;
	image: string;
	state: string; // running | exited | restarting | paused | created | dead
	status: string; // human readable, e.g. "Up 3 hours (healthy)"
	health: string; // healthy | unhealthy | starting | none
	ports: string;
	createdAt: string;
	project: string;
	service: string;
	workingDir: string;
}

const L = (key: string) => `{{json (.Label "${key}")}}`;
const PS_FORMAT =
	`{"id":{{json .ID}},"name":{{json .Names}},"image":{{json .Image}},"state":{{json .State}},` +
	`"status":{{json .Status}},"ports":{{json .Ports}},"createdAt":{{json .CreatedAt}},` +
	`"project":${L('com.docker.compose.project')},"service":${L('com.docker.compose.service')},` +
	`"workingDir":${L('com.docker.compose.project.working_dir')}}`;

function healthFromStatus(status: string) {
	if (status.includes('(healthy)')) return 'healthy';
	if (status.includes('(unhealthy)')) return 'unhealthy';
	if (status.includes('health: starting')) return 'starting';
	return 'none';
}

let psCache: { at: number; promise: Promise<Container[]> } | undefined;

export function invalidateContainers() {
	psCache = undefined;
}

/** All containers on the host (cached for a moment, many views poll this). */
export function listContainers(): Promise<Container[]> {
	if (psCache && Date.now() - psCache.at < 1500) return psCache.promise;
	const promise = (async () => {
		const { stdout } = await runOk('docker', ['ps', '-a', '--no-trunc', '--format', PS_FORMAT], {
			timeout: 20_000
		});
		return parseLines<Omit<Container, 'health'>>(stdout).map((c) => ({
			...c,
			project: c.project || '',
			service: c.service || '',
			workingDir: c.workingDir || '',
			health: healthFromStatus(c.status)
		}));
	})();
	psCache = { at: Date.now(), promise };
	promise.catch(() => (psCache = undefined));
	return promise;
}

export interface ContainerDetails {
	id: string;
	name: string;
	imageId: string;
	volumes: string[];
}

export async function inspectContainers(ids: string[]): Promise<ContainerDetails[]> {
	if (ids.length === 0) return [];
	const fmt =
		'{"id":{{json .Id}},"name":{{json .Name}},"imageId":{{json .Image}},' +
		'"volumes":[{{range $i, $m := .Mounts}}{{if eq $m.Type "volume"}}{{if $i}},{{end}}{{json $m.Name}}{{end}}{{end}}]}';
	const { stdout } = await runOk('docker', ['container', 'inspect', '--format', fmt, ...ids]);
	// the range trick can leave a leading comma when the first mount is not a volume
	return parseLines<ContainerDetails>(stdout.replace(/\[,/g, '['));
}

export interface Image {
	id: string;
	tags: string[];
	digests: string[];
	size: number;
	created: string;
}

export async function listImages(): Promise<Image[]> {
	const ids = await runOk('docker', ['image', 'ls', '-a', '-q', '--no-trunc']);
	const unique = [...new Set(ids.stdout.split('\n').filter(Boolean))];
	if (unique.length === 0) return [];
	const fmt =
		'{"id":{{json .Id}},"tags":{{json .RepoTags}},"digests":{{json .RepoDigests}},"size":{{json .Size}},"created":{{json .Created}}}';
	const { stdout } = await run('docker', ['image', 'inspect', '--format', fmt, ...unique]);
	return parseLines<Image>(stdout).map((i) => ({
		...i,
		tags: i.tags ?? [],
		digests: i.digests ?? []
	}));
}

export async function inspectImage(ref: string): Promise<Image | null> {
	const fmt =
		'{"id":{{json .Id}},"tags":{{json .RepoTags}},"digests":{{json .RepoDigests}},"size":{{json .Size}},"created":{{json .Created}}}';
	const res = await run('docker', ['image', 'inspect', '--format', fmt, ref]);
	if (res.code !== 0) return null;
	const [img] = parseLines<Image>(res.stdout);
	return img ? { ...img, tags: img.tags ?? [], digests: img.digests ?? [] } : null;
}

export interface Volume {
	name: string;
	driver: string;
	mountpoint: string;
	createdAt: string;
	labels: Record<string, string>;
}

export async function listVolumes(): Promise<Volume[]> {
	const names = await runOk('docker', ['volume', 'ls', '-q']);
	const list = names.stdout.split('\n').filter(Boolean);
	if (list.length === 0) return [];
	const fmt =
		'{"name":{{json .Name}},"driver":{{json .Driver}},"mountpoint":{{json .Mountpoint}},"createdAt":{{json .CreatedAt}},"labels":{{json .Labels}}}';
	const { stdout } = await run('docker', ['volume', 'inspect', '--format', fmt, ...list]);
	return parseLines<Volume>(stdout).map((v) => ({ ...v, labels: v.labels ?? {} }));
}

// ---------------------------------------------------------------------------
// image references

export interface ImageRef {
	registry: string; // e.g. docker.io, ghcr.io
	repository: string; // e.g. library/nginx
	tag: string;
	digest?: string;
}

/** Parses an image reference the same way docker does (normalized). */
export function parseImageRef(ref: string): ImageRef {
	let rest = ref.trim();
	let digest: string | undefined;
	const at = rest.indexOf('@');
	if (at !== -1) {
		digest = rest.slice(at + 1);
		rest = rest.slice(0, at);
	}
	let registry = 'docker.io';
	const slash = rest.indexOf('/');
	if (slash !== -1) {
		const first = rest.slice(0, slash);
		if (first.includes('.') || first.includes(':') || first === 'localhost') {
			registry = first;
			rest = rest.slice(slash + 1);
		}
	}
	let tag = 'latest';
	const colon = rest.lastIndexOf(':');
	if (colon !== -1) {
		tag = rest.slice(colon + 1);
		rest = rest.slice(0, colon);
	} else if (digest) {
		tag = '';
	}
	if (registry === 'index.docker.io') registry = 'docker.io';
	let repository = rest.toLowerCase();
	if (registry === 'docker.io' && !repository.includes('/')) repository = `library/${repository}`;
	return { registry, repository, tag, digest };
}

/** `registry/repository` key, used to compare image names. */
export function repoKey(ref: string | ImageRef) {
	const r = typeof ref === 'string' ? parseImageRef(ref) : ref;
	return `${r.registry}/${r.repository}`;
}

export function fullRef(ref: string) {
	const r = parseImageRef(ref);
	return `${r.registry}/${r.repository}${r.tag ? `:${r.tag}` : ''}${r.digest ? `@${r.digest}` : ''}`;
}

/** The registry digest a local image was pulled with, for the given repository. */
export function localDigestFor(image: Image, ref: string): string | null {
	const key = repoKey(ref);
	for (const d of image.digests) {
		const [name, digest] = d.split('@');
		if (repoKey(name) === key && digest) return digest;
	}
	return null;
}
