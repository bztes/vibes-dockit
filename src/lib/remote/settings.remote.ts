import * as v from 'valibot';
import { form, query } from '$app/server';
import { getConfig, updateConfig } from '#lib/server/config.js';
import { requireAdmin, requireUser } from '#lib/server/auth.js';
import { getRoot } from '#lib/server/projects.js';
import { getSelf } from '#lib/server/self.js';
import { lastFullCheck } from '#lib/server/updates.js';

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
