import { query } from '$app/server';
import { requireUserCommand } from '#lib/server/auth.js';
import { subscribeSystemLoad, type SystemLoad } from '#lib/server/system.js';

export const watchSystemLoad = query.live(async function* () {
	requireUserCommand();
	let pending: SystemLoad | null = null;
	let wake: (() => void) | null = null;
	const unsubscribe = subscribeSystemLoad((s) => {
		pending = s;
		wake?.();
	});
	try {
		while (true) {
			if (!pending) await new Promise<void>((r) => (wake = r));
			wake = null;
			const s = pending!;
			pending = null;
			yield s;
		}
	} finally {
		unsubscribe();
	}
});
