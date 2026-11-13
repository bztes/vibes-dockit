import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { command, query } from '$app/server';
import { getConfig, updateConfig } from '#lib/server/config.js';
import { requireUser, requireUserCommand } from '#lib/server/auth.js';
import { sendToChannel } from '#lib/server/notify.js';
import { EVENT_IDS, type Channel } from '#lib/notifications.js';

const MASK = '••••••••';

/** Secrets are never sent to the browser. */
function masked(c: Channel): Channel {
	if (c.type === 'email' && c.config.password)
		return { ...c, config: { ...c.config, password: MASK } };
	if (c.type === 'ntfy' && c.config.token) return { ...c, config: { ...c.config, token: MASK } };
	return c;
}

export const listChannels = query(async () => {
	requireUser();
	return getConfig().notifications.map(masked);
});

const base = {
	id: v.optional(v.string()),
	name: v.pipe(v.string(), v.trim(), v.nonEmpty()),
	enabled: v.boolean(),
	events: v.array(v.picklist(EVENT_IDS)),
	projects: v.array(v.string())
};

const ChannelSchema = v.variant('type', [
	v.object({
		...base,
		type: v.literal('ntfy'),
		config: v.object({
			server: v.pipe(v.string(), v.trim(), v.url()),
			topic: v.pipe(v.string(), v.trim(), v.nonEmpty()),
			token: v.optional(v.string()),
			priority: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(5)))
		})
	}),
	v.object({
		...base,
		type: v.literal('email'),
		config: v.object({
			host: v.pipe(v.string(), v.trim(), v.nonEmpty()),
			port: v.pipe(v.number(), v.integer()),
			secure: v.boolean(),
			username: v.optional(v.string()),
			password: v.optional(v.string()),
			from: v.pipe(v.string(), v.trim(), v.nonEmpty()),
			to: v.pipe(v.string(), v.trim(), v.nonEmpty())
		})
	}),
	v.object({
		...base,
		type: v.literal('webhook'),
		config: v.object({
			url: v.pipe(v.string(), v.trim(), v.url()),
			headers: v.optional(v.string())
		})
	})
]);

/** keeps stored secrets when the masked placeholder is sent back */
function withSecrets(next: Channel, prev: Channel | undefined): Channel {
	if (!prev || prev.type !== next.type) return next;
	if (next.type === 'email' && prev.type === 'email' && next.config.password === MASK) {
		return { ...next, config: { ...next.config, password: prev.config.password } };
	}
	if (next.type === 'ntfy' && prev.type === 'ntfy' && next.config.token === MASK) {
		return { ...next, config: { ...next.config, token: prev.config.token } };
	}
	return next;
}

export const saveChannel = command(ChannelSchema, async (input) => {
	requireUserCommand();
	const id = input.id || crypto.randomUUID();
	await updateConfig((c) => {
		const prev = c.notifications.find((n) => n.id === id);
		const channel = withSecrets({ ...input, id } as Channel, prev);
		if (prev) c.notifications = c.notifications.map((n) => (n.id === id ? channel : n));
		else c.notifications.push(channel);
	});
	void listChannels().refresh();
	return id;
});

export const deleteChannel = command(v.string(), async (id) => {
	requireUserCommand();
	await updateConfig((c) => {
		c.notifications = c.notifications.filter((n) => n.id !== id);
	});
	void listChannels().refresh();
});

export const toggleChannel = command(
	v.object({ id: v.string(), enabled: v.boolean() }),
	async (input) => {
		requireUserCommand();
		await updateConfig((c) => {
			const ch = c.notifications.find((n) => n.id === input.id);
			if (ch) ch.enabled = input.enabled;
		});
		void listChannels().refresh();
	}
);

export const testChannel = command(ChannelSchema, async (input) => {
	requireUserCommand();
	const prev = getConfig().notifications.find((n) => n.id === input.id);
	const channel = withSecrets({ ...input, id: input.id ?? 'test' } as Channel, prev);
	try {
		await sendToChannel(channel, {
			type: 'update_available',
			project: null,
			title: 'Dockit test notification',
			message: `If you can read this, the channel "${channel.name}" works. 🎉`
		});
	} catch (e) {
		error(400, e instanceof Error ? e.message : String(e));
	}
	return true;
});
