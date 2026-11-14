import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { command, query } from '$app/server';
import { getConfig } from '#lib/server/config.js';
import { db } from '#lib/server/db/index.js';
import { notificationChannel } from '#lib/server/db/schema.js';
import { requireUser, requireUserCommand } from '#lib/server/auth.js';
import { sendToChannel, toChannel } from '#lib/server/notify.js';
import { EVENT_IDS, type Channel } from '#lib/notifications.js';

const MASK = '••••••••';

/** Secrets are never sent to the browser. */
function masked(c: Channel): Channel {
	if (c.type === 'ntfy' && c.config.token) return { ...c, config: { ...c.config, token: MASK } };
	return c;
}

/** Channels belong to the logged in user; other users' channels are invisible. */
async function ownChannel(userId: string, id: string | undefined) {
	if (!id) return undefined;
	const [row] = await db
		.select()
		.from(notificationChannel)
		.where(and(eq(notificationChannel.id, id), eq(notificationChannel.userId, userId)));
	return row && toChannel(row);
}

export const listChannels = query(async () => {
	const me = requireUser();
	const rows = await db
		.select()
		.from(notificationChannel)
		.where(eq(notificationChannel.userId, me.id))
		.orderBy(asc(notificationChannel.createdAt));
	return rows.map(toChannel).map(masked);
});

/** Whether an admin has set up the global SMTP server (needed for email channels). */
export const getEmailAvailable = query(async () => {
	requireUser();
	return !!getConfig().smtp;
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
	if (next.type === 'ntfy' && prev?.type === 'ntfy' && next.config.token === MASK) {
		return { ...next, config: { ...next.config, token: prev.config.token } };
	}
	return next;
}

export const saveChannel = command(ChannelSchema, async (input) => {
	const me = requireUserCommand();
	const prev = await ownChannel(me.id, input.id);
	if (input.id && !prev) error(404, 'Channel not found');
	const { name, type, enabled, events, projects, config } = withSecrets(
		{ ...input, id: input.id ?? '' } as Channel,
		prev
	);
	const channel = { name, type, enabled, events, projects, config };
	let id = input.id;
	if (prev) {
		await db
			.update(notificationChannel)
			.set(channel)
			.where(and(eq(notificationChannel.id, prev.id), eq(notificationChannel.userId, me.id)));
	} else {
		[{ id }] = await db
			.insert(notificationChannel)
			.values({ ...channel, userId: me.id })
			.returning({ id: notificationChannel.id });
	}
	void listChannels().refresh();
	return id!;
});

export const deleteChannel = command(v.string(), async (id) => {
	const me = requireUserCommand();
	await db
		.delete(notificationChannel)
		.where(and(eq(notificationChannel.id, id), eq(notificationChannel.userId, me.id)));
	void listChannels().refresh();
});

export const toggleChannel = command(
	v.object({ id: v.string(), enabled: v.boolean() }),
	async (input) => {
		const me = requireUserCommand();
		await db
			.update(notificationChannel)
			.set({ enabled: input.enabled })
			.where(and(eq(notificationChannel.id, input.id), eq(notificationChannel.userId, me.id)));
		void listChannels().refresh();
	}
);

export const testChannel = command(ChannelSchema, async (input) => {
	const me = requireUserCommand();
	const prev = await ownChannel(me.id, input.id);
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
