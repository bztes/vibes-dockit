import * as v from 'valibot';
import { command, query } from '$app/server';
import { requireUser, requireUserCommand } from '#lib/server/auth.js';
import { logActivity } from '#lib/server/db/index.js';
import { NAME_RE } from '#lib/server/projects.js';
import { getFiles } from '#lib/remote/projects.remote.js';
import {
	addProjectHooks,
	backupProject,
	forgetSnapshot,
	listSnapshots,
	readProjectBackup,
	removeProjectHooks,
	restoreProject,
	saveProjectBackup,
	saveProjectHooks
} from './restic.server';
import { PHASES } from './hooks';
import { PRESETS } from './presets';

const projectName = v.pipe(v.string(), v.regex(NAME_RE, 'Invalid project name'));
const lines = v.array(v.pipe(v.string(), v.trim(), v.nonEmpty()));

export const getBackup = query(projectName, async (name) => {
	requireUser();
	return readProjectBackup(name);
});

export const getSnapshots = query(projectName, async (name) => {
	requireUser();
	try {
		return { snapshots: await listSnapshots(name), error: null };
	} catch (e) {
		return { snapshots: [], error: e instanceof Error ? e.message : String(e) };
	}
});

export const saveBackup = command(
	v.object({
		name: projectName,
		settings: v.nullable(
			v.object({
				schedule: v.pipe(v.string(), v.trim(), v.regex(/^[^\n"]*$/, 'Invalid schedule')),
				exclude: lines,
				excludeVolumes: lines,
				beforeUpdate: v.boolean()
			})
		)
	}),
	async ({ name, settings }) => {
		const me = requireUserCommand();
		const problem = await saveProjectBackup(name, settings);
		void getBackup(name).refresh();
		if (problem) return { error: problem };
		await logActivity({
			project: name,
			type: 'edit',
			message: `Backups ${settings ? 'configured' : 'disabled'} by ${me.username}`
		});
		void getFiles(name).refresh();
		return { error: null };
	}
);

export const backupNow = command(projectName, async (name) => {
	const me = requireUserCommand();
	const job = await backupProject(name, me.username);
	return { jobId: job.id };
});

const snapshotId = v.pipe(v.string(), v.regex(/^[0-9a-f]{8,64}$/, 'Invalid snapshot id'));

export const deleteSnapshot = command(
	v.object({ name: projectName, snapshot: snapshotId, prune: v.boolean() }),
	async ({ name, snapshot, prune }) => {
		const me = requireUserCommand();
		const job = await forgetSnapshot(name, snapshot, prune, me.username);
		return { jobId: job.id };
	}
);

export const restoreSnapshot = command(
	v.object({
		name: projectName,
		snapshot: snapshotId,
		files: v.boolean(),
		volumes: v.array(v.pipe(v.string(), v.regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/))),
		delete: v.boolean()
	}),
	async ({ name, ...options }) => {
		const me = requireUserCommand();
		const job = await restoreProject(name, options, me.username);
		void getFiles(name).refresh();
		return { jobId: job.id };
	}
);

const serviceName = v.pipe(v.string(), v.regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, 'Invalid service'));

/** Refreshes the backup and logs a change of the hooks. */
async function hooksChange(
	name: string,
	change: Promise<{ changed: boolean; error: string | null }>,
	message: string
) {
	const { changed, error } = await change;
	void getBackup(name).refresh();
	if (changed) {
		void getFiles(name).refresh();
		await logActivity({ project: name, type: 'edit', message });
	}
	return { error };
}

export const addHooks = command(
	v.object({ name: projectName, service: serviceName, preset: v.picklist(PRESETS) }),
	async ({ name, service, preset }) => {
		const me = requireUserCommand();
		return hooksChange(
			name,
			addProjectHooks(name, service, preset),
			`Backup hooks for ${service} added by ${me.username}`
		);
	}
);

export const saveHooks = command(
	v.object({
		name: projectName,
		set: serviceName,
		scripts: v.partial(
			v.object(
				Object.fromEntries(PHASES.map((p) => [p, v.string()])) as Record<
					(typeof PHASES)[number],
					v.StringSchema<undefined>
				>
			)
		)
	}),
	async ({ name, set, scripts }) => {
		const me = requireUserCommand();
		return hooksChange(
			name,
			saveProjectHooks(name, set, scripts),
			`Backup hooks of ${set} edited by ${me.username}`
		);
	}
);

export const removeHooks = command(
	v.object({ name: projectName, set: serviceName }),
	async ({ name, set }) => {
		const me = requireUserCommand();
		return hooksChange(
			name,
			removeProjectHooks(name, set),
			`Backup hooks of ${set} removed by ${me.username}`
		);
	}
);
