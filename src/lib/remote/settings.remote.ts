import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { command, form, query } from '$app/server';
import { getConfig, updateConfig } from '#lib/server/config.js';
import { requireAdmin, requireUser } from '#lib/server/auth.js';
import { getRoot } from '#lib/server/projects.js';
import { getSelf } from '#lib/server/self.js';
import { lastFullCheck } from '#lib/server/updates.js';
import { smtpTransport } from '#lib/server/notify.js';
import type { SmtpSettings } from '#lib/notifications.js';

export const getSettings = query(async () => {
	requireUser();
	const c = getConfig();
	return {
		projectsRoot: getRoot(),
		updateCheckIntervalHours: c.updateCheckIntervalHours,
		pruneImagesAfterUpdate: c.pruneImagesAfterUpdate,
		self: getSelf(),
		lastFullCheck
	};
});

export const saveSettings = form(
	v.object({
		updateCheckIntervalHours: v.pipe(v.number(), v.minValue(0), v.maxValue(24 * 7)),
		pruneImagesAfterUpdate: v.optional(v.boolean(), false)
	}),
	async (data) => {
		requireAdmin();
		await updateConfig((c) => {
			c.updateCheckIntervalHours = data.updateCheckIntervalHours;
			c.pruneImagesAfterUpdate = data.pruneImagesAfterUpdate;
		});
		return { saved: true };
	}
);

const MASK = '••••••••';

/** Global mail server used by every user's email channels. */
export const getSmtp = query(async () => {
	requireAdmin();
	const smtp = getConfig().smtp;
	return smtp && { ...smtp, password: smtp.password ? MASK : '' };
});

const SmtpSchema = v.object({
	host: v.pipe(v.string(), v.trim(), v.nonEmpty('Required')),
	port: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
	secure: v.boolean(),
	username: v.optional(v.pipe(v.string(), v.trim())),
	password: v.optional(v.string()),
	from: v.pipe(v.string(), v.trim(), v.nonEmpty('Required'))
});

/** keeps the stored password when the masked placeholder is sent back */
function withPassword(next: SmtpSettings): SmtpSettings {
	if (next.password !== MASK) return next;
	return { ...next, password: getConfig().smtp?.password };
}

/** `null` removes the SMTP server (email channels stop working). */
export const saveSmtp = command(v.nullable(SmtpSchema), async (input) => {
	requireAdmin();
	await updateConfig((c) => {
		c.smtp = input && withPassword(input);
	});
	void getSmtp().refresh();
});

export const verifySmtp = command(SmtpSchema, async (input) => {
	requireAdmin();
	try {
		await smtpTransport(withPassword(input)).verify();
	} catch (e) {
		error(400, e instanceof Error ? e.message : String(e));
	}
	return true;
});
