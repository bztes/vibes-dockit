import * as v from 'valibot';
import { command, query } from '$app/server';
import { requireUser, requireUserCommand } from '#lib/server/auth.js';
import { logActivity } from '#lib/server/db/index.js';
import { NAME_RE } from '#lib/server/projects.js';
import { getFiles } from '#lib/remote/projects.remote.js';
import {
	backupProject,
	listSnapshots,
	readProjectBackup,
	restoreProject,
	saveProjectBackup
} from './restic.server';

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

export const restoreSnapshot = command(
	v.object({
		name: projectName,
		snapshot: v.pipe(v.string(), v.regex(/^[0-9a-f]{8,64}$/, 'Invalid snapshot id')),
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
