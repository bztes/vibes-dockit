import type { ProjectTab, Template, TemplateTab } from './types';

export type { ProjectTab, Template, TemplateTab } from './types';

/** every `src/lib/templates/<id>/index.ts` default-exports its template */
export const templates = Object.values(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	import.meta.glob<Template<any>>('./*/index.ts', { eager: true, import: 'default' })
);

export function getTemplate(id: string | null | undefined) {
	return templates.find((t) => t.id === id) ?? null;
}

/** Resolves the tabs the server reported for a project to their components. */
export function resolveTabs(tabs: ProjectTab[]): (TemplateTab & { count?: number })[] {
	return tabs.flatMap((t) => {
		const tab = getTemplate(t.template)?.tabs?.find((x) => x.id === t.id);
		return tab ? [{ ...tab, count: t.count }] : [];
	});
}
