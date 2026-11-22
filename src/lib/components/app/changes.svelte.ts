import { untrack } from 'svelte';
import { watchOverview } from '#lib/remote/projects.remote.js';

type Overview = NonNullable<ReturnType<typeof watchOverview>['current']>;

/**
 * Calls `refresh` whenever docker or a job changed something (a new `rev` of the overview).
 * Pages keep their data in plain queries and refetch them with this, instead of opening
 * their own live queries (see `watchOverview` for why). Call it during component init.
 */
export function onChange(refresh: (overview: Overview) => void) {
	// same stream as the sidebar, so this opens no extra connection
	const overview = watchOverview();
	let seen: number | undefined;
	$effect(() => {
		const current = overview.current;
		if (!current) return;
		if (seen !== undefined && current.rev !== seen) untrack(() => refresh(current));
		seen = current.rev;
	});
}
