import type * as v from 'valibot';
import type { ProjectTab } from '#lib/templates/types.js';
import type { ProjectInfo } from './projects';

export interface ComposeService {
	name: string;
	image: string | null;
	build: boolean;
}

/** Server side of a template (the client side lives in `#lib/templates`). */
export interface ServerTemplate<V = unknown> {
	id: string;
	/** validates the values of the config form */
	schema: v.GenericSchema<unknown, V>;
	/** reason why the template can't be used right now */
	unavailable?: () => Promise<string | null>;
	/** files of the new project, may prepare host resources (e.g. docker networks) */
	create: (values: V) => Promise<{
		compose: string;
		env?: string;
		/** further files, path relative to the project folder → content (written with mode 600) */
		files?: Record<string, string>;
	}>;
	afterCreate?: (name: string) => void | Promise<void>;
	/** tabs this template adds to `project` */
	tabs?: (project: ProjectInfo) => Promise<Omit<ProjectTab, 'template'>[]>;
	/** runs before `docker compose up` of any project */
	beforeUp?: (compose: string, log?: (text: string) => void) => Promise<void>;
	/** whether a compose file is an instance of this template (e.g. by image) */
	matches?: (services: ComposeService[]) => boolean;
	/** links the template's configuration adds to a project (parsed compose json) */
	links?: (json: Record<string, unknown>) => string[];
}

/** every `src/lib/templates/<id>/<id>.server.ts` default-exports its server template */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const modules = import.meta.glob<ServerTemplate<any>>('../templates/*/*.server.ts', {
	eager: true,
	import: 'default'
});
// read lazily: templates import projects.ts, which imports this module
const all = () => Object.values(modules);

export function getServerTemplate(id: string) {
	return all().find((t) => t.id === id) ?? null;
}

export async function templateAvailability() {
	return Promise.all(
		all().map(async (t) => ({ id: t.id, unavailable: (await t.unavailable?.()) ?? null }))
	);
}

export async function projectTabs(project: ProjectInfo): Promise<ProjectTab[]> {
	const lists = await Promise.all(
		all().map(async (t) =>
			((await t.tabs?.(project)) ?? []).map((tab) => ({ ...tab, template: t.id }))
		)
	);
	return lists.flat();
}

export async function beforeUp(compose: string, log?: (text: string) => void) {
	for (const t of all()) await t.beforeUp?.(compose, log);
}

/** Id of the first template the services match. */
export function matchTemplate(services: ComposeService[]) {
	return all().find((t) => t.matches?.(services))?.id ?? null;
}

export function templateLinks(json: Record<string, unknown>) {
	return all().flatMap((t) => t.links?.(json) ?? []);
}
