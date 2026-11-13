import nodemailer from 'nodemailer';
import { getConfig } from './config';
import { logActivity } from './db';
import { EVENT_TYPES, type Channel, type EventType } from '#lib/notifications.js';

export interface NotificationEvent {
	type: EventType;
	project: string | null;
	title: string;
	message: string;
}

const TAGS: Record<EventType, string> = {
	update_available: 'package',
	update_success: 'white_check_mark',
	update_failed: 'x',
	container_died: 'rotating_light',
	container_unhealthy: 'warning',
	action_failed: 'x'
};

async function sendNtfy(channel: Extract<Channel, { type: 'ntfy' }>, event: NotificationEvent) {
	const { server, topic, token, priority } = channel.config;
	const base = (server || 'https://ntfy.sh').replace(/\/+$/, '');
	const res = await fetch(`${base}/${encodeURIComponent(topic)}`, {
		method: 'POST',
		body: event.message,
		headers: {
			Title: encodeHeader(event.title),
			Tags: TAGS[event.type],
			Priority: String(
				priority ?? (event.type.includes('fail') || event.type.includes('died') ? 4 : 3)
			),
			...(token ? { Authorization: `Bearer ${token}` } : {})
		},
		signal: AbortSignal.timeout(15_000)
	});
	if (!res.ok) throw new Error(`ntfy responded with ${res.status}: ${await res.text()}`);
}

/** HTTP headers must be latin1; ntfy supports RFC 2047 encoded words. */
function encodeHeader(value: string) {
	return /^[\x20-\x7e]*$/.test(value)
		? value
		: `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

async function sendEmail(channel: Extract<Channel, { type: 'email' }>, event: NotificationEvent) {
	const c = channel.config;
	const transport = nodemailer.createTransport({
		host: c.host,
		port: c.port,
		secure: c.secure,
		auth: c.username ? { user: c.username, pass: c.password ?? '' } : undefined,
		connectionTimeout: 15_000
	});
	await transport.sendMail({
		from: c.from,
		to: c.to,
		subject: `[dockit] ${event.title}`,
		text: `${event.message}\n\n— dockit`
	});
}

async function sendWebhook(
	channel: Extract<Channel, { type: 'webhook' }>,
	event: NotificationEvent
) {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	for (const line of (channel.config.headers ?? '').split('\n')) {
		const i = line.indexOf(':');
		if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
	}
	const res = await fetch(channel.config.url, {
		method: 'POST',
		headers,
		body: JSON.stringify({
			...event,
			// discord / slack compatible fields
			content: `**${event.title}**\n${event.message}`,
			text: `*${event.title}*\n${event.message}`,
			timestamp: new Date().toISOString()
		}),
		signal: AbortSignal.timeout(15_000)
	});
	if (!res.ok) throw new Error(`webhook responded with ${res.status}`);
}

export async function sendToChannel(channel: Channel, event: NotificationEvent) {
	switch (channel.type) {
		case 'ntfy':
			return sendNtfy(channel, event);
		case 'email':
			return sendEmail(channel, event);
		case 'webhook':
			return sendWebhook(channel, event);
	}
}

/** Sends an event to all matching channels. Never throws. */
export async function notify(event: NotificationEvent) {
	const level =
		event.type === 'update_success'
			? 'success'
			: event.type === 'update_available'
				? 'info'
				: 'error';
	await logActivity({ project: event.project, type: event.type, level, message: event.title });

	const channels = getConfig().notifications.filter(
		(c) =>
			c.enabled &&
			c.events.includes(event.type) &&
			(c.projects.length === 0 || (event.project && c.projects.includes(event.project)))
	);
	await Promise.all(
		channels.map(async (c) => {
			try {
				await sendToChannel(c, event);
			} catch (e) {
				console.error(`[dockit] notification "${c.name}" failed`, e);
				await logActivity({
					project: event.project,
					type: 'notification_failed',
					level: 'warning',
					message: `Notification "${c.name}" failed: ${e instanceof Error ? e.message : e}`
				});
			}
		})
	);
}

export function eventLabel(type: EventType) {
	return EVENT_TYPES.find((e) => e.id === type)?.label ?? type;
}
