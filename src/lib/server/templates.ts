import type * as v from 'valibot';
import type { ProjectTab } from '#lib/templates/types.js';
import type { ProjectAction } from './actions';
import type { JobContext } from './jobs';
import type { ProjectInfo, ProjectSources } from './projects';
import { getSection, type DockitConfig } from '#lib/dockit-config.js';

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
		/** `dockit.json` of the new project */
		config?: DockitConfig;
	}>;
	afterCreate?: (name: string) => void | Promise<void>;
	/** tabs this template adds to `project` */
	tabs?: (project: ProjectInfo) => Promise<Omit<ProjectTab, 'template'>[]>;
	/** applies template state derived from all projects (at start and after every project change) */
	sync?: () => Promise<void>;
	/** runs in the job of an action on any project before it starts, e.g. a backup before an update */
	beforeAction?: (project: ProjectInfo, action: ProjectAction, ctx: JobContext) => Promise<void>;
	/** runs before `docker compose up` of any project */
	beforeUp?: (project: ProjectInfo, log?: (text: string) => void) => Promise<void>;
	/**
	 * Moves the template's changes of an older project (from before `dockit.json`
	 * and the override file) out of the compose file. Runs once, when the project is loaded.
	 */
	migrate?: (sources: ProjectSources) => Partial<ProjectSources>;
	/** whether a compose file is an instance of this template (e.g. by image) */
	matches?: (services: ComposeService[]) => boolean;
	/** links the template's section of `dockit.json` (keyed by the template id) adds to a project */
	links?: (section: Record<string, unknown>) => string[];
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

export async function beforeUp(project: ProjectInfo, log?: (text: string) => void) {
	for (const t of all()) await t.beforeUp?.(project, log);
}

export async function beforeAction(project: ProjectInfo, action: ProjectAction, ctx: JobContext) {
	for (const t of all()) await t.beforeAction?.(project, action, ctx);
}

/** A project was created, changed or removed. Runs in the background. */
export function syncTemplates() {
	for (const t of all()) {
		t.sync?.().catch((e) => console.error(`[dockit] sync of template ${t.id} failed`, e));
	}
}

/** Applies the migrations of all templates. A failing one is skipped. */
export function migrateTemplates(sources: ProjectSources): ProjectSources {
	let next = sources;
	for (const t of all()) {
		try {
			next = { ...next, ...t.migrate?.(next) };
		} catch (e) {
			console.error(`[dockit] migration of template ${t.id} failed`, e);
		}
	}
	return next;
}

/** Id of the first template the services match. */
export function matchTemplate(services: ComposeService[]) {
	return all().find((t) => t.matches?.(services))?.id ?? null;
}

export function templateLinks(config: DockitConfig) {
	return all().flatMap((t) => {
		const section = getSection(config, t.id);
		return section ? (t.links?.(section) ?? []) : [];
	});
}
