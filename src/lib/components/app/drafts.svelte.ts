import { untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';

/**
 * Unsaved edits, kept while switching tabs and projects (not across reloads: `.env` drafts
 * hold secrets, they stay out of browser storage). Keys are `<project>/<tab>[/<more>]`, so
 * a tab or a project can show that it has unsaved edits.
 */
interface Entry {
	/** the saved version the edits started from, to notice changes made elsewhere */
	base: string;
	/** may be the editor's live `$state`: only read (as a snapshot) when an editor mounts */
	value: unknown;
}

const drafts = new SvelteMap<string, Entry>();

export const draftKey = (project: string, ...path: string[]) => [project, ...path].join('/');

export interface Draft<T> {
	/** the edits kept from an earlier visit, to start the editor from */
	readonly saved: T | undefined;
	/** whether the saved version changed since the edits started */
	readonly stale: boolean;
	/** keep the edits, but against the current saved version */
	rebase(): void;
	/** forget the edits, for an editor that its parent re-mounts after saving */
	drop(): void;
}

/**
 * Keeps an editor's edits under `key` while they differ from the saved version (`dirty`),
 * drops them otherwise. Call it while the component initializes.
 */
export function useDraft<T>(
	key: string,
	opts: { base: () => string; dirty: () => boolean; value: () => T }
): Draft<T> {
	const saved = $state.snapshot(drafts.get(key)?.value) as T | undefined;

	$effect(() => {
		const dirty = opts.dirty();
		const value = opts.value();
		const base = opts.base();
		untrack(() => {
			const entry = drafts.get(key);
			if (!dirty) drafts.delete(key);
			// only adding or removing an entry notifies `hasDrafts`, not every keystroke
			else if (entry) entry.value = value;
			else drafts.set(key, { base, value });
		});
	});

	return {
		saved,
		get stale() {
			const entry = drafts.get(key);
			return !!entry && entry.base !== opts.base();
		},
		rebase() {
			const entry = drafts.get(key);
			if (entry) drafts.set(key, { ...entry, base: opts.base() });
		},
		drop() {
			drafts.delete(key);
		}
	};
}

/** whether there are unsaved edits anywhere, in a project, or in one of its tabs */
export function hasDrafts(project?: string, tab?: string) {
	if (project === undefined) return drafts.size > 0;
	const prefix = tab === undefined ? project : draftKey(project, tab);
	for (const k of drafts.keys()) if (k === prefix || k.startsWith(`${prefix}/`)) return true;
	return false;
}
