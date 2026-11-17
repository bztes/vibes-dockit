import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { command, query } from '$app/server';
import { requireUserCommand } from '#lib/server/auth.js';
import { logActivity } from '#lib/server/db/index.js';
import { nextChange } from '#lib/server/monitor.js';
import { getTopology, removeObject as remove } from '#lib/server/topology.js';
import { imageName } from '#lib/components/topology/layout.js';

export const watchTopology = query.live(async function* () {
	requireUserCommand();
	let last = '';
	while (true) {
		const data = await getTopology();
		const json = JSON.stringify(data);
		if (json !== last) {
			last = json;
			yield data;
		}
		await nextChange(15_000, { resources: true });
	}
});

const dockerName = v.pipe(v.string(), v.regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, 'Invalid name'));

export const removeObject = command(
	v.variant('kind', [
		v.object({ kind: v.literal('container'), id: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/)) }),
		v.object({
			kind: v.literal('image'),
			id: v.pipe(v.string(), v.regex(/^sha256:[a-f0-9]{64}$/))
		}),
		v.object({ kind: v.literal('volume'), id: dockerName }),
		v.object({ kind: v.literal('network'), id: dockerName })
	]),
	async ({ kind, id }) => {
		const me = requireUserCommand();
		try {
			let project: string | null = null;
			let label = id;
			if (kind === 'container') {
				const c = await remove('container', id);
				project = c.project;
				label = c.name;
			} else if (kind === 'image') {
				label = imageName(await remove('image', id));
			} else {
				await remove(kind, id);
			}
			await logActivity({
				project,
				type: 'remove',
				level: 'warning',
				message: `${me.username} removed ${kind} ${label}`
			});
		} catch (e) {
			error(400, (e as Error).message);
		}
	}
);
