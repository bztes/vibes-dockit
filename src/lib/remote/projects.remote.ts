import * as v from 'valibot';
import { spawn } from 'node:child_process';
import { error } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { command, query } from '$app/server';
import { requireUser, requireUserCommand } from '#lib/server/auth.js';
import { db, logActivity } from '#lib/server/db/index.js';
import { activity } from '#lib/server/db/schema.js';
import { getOverview, getProjectStatus } from '#lib/server/status.js';
import { nextChange } from '#lib/server/monitor.js';
import { getJob, jobEvents, listJobs, startJob, waitForJob } from '#lib/server/jobs.js';
import { PROJECT_ACTIONS, runContainerAction, runProjectAction } from '#lib/server/actions.js';
import {
	NAME_RE,
	createProjectFolder,
	loadProject,
	projectDir,
	readProjectFiles,
	restoreSecrets,
	trashProject,
	validateCompose,
	writeCompose,
	writeEnv,
	writeMeta
} from '#lib/server/projects.js';
import { getProjectResources } from '#lib/server/resources.js';
import { checkAllUpdates, checkUpdatesByName } from '#lib/server/updates.js';
import { listContainers } from '#lib/server/docker.js';
import { run } from '#lib/server/exec.js';
import { getSelf } from '#lib/server/self.js';
import { unmaskEnv } from '#lib/env.js';

const missingSecrets = (keys: string[]) =>
	`No value stored for secret ${keys.join(', ')}. Please enter a value.`;

const projectName = v.pipe(v.string(), v.regex(NAME_RE, 'Invalid project name'));

/** resolves on the next docker or job change, or after `timeout` ms */
function nextTick(timeout: number) {
	return new Promise<void>((resolve) => {
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			jobEvents.off('change', onJob);
			resolve();
		};
		const onJob = () => setTimeout(finish, 100);
		jobEvents.on('change', onJob);
		nextChange(timeout).then(finish);
	});
}

// ---------------------------------------------------------------------------
// status

export const watchOverview = query.live(async function* () {
	requireUserCommand();
	let last = '';
	while (true) {
		const data = await getOverview();
		const json = JSON.stringify(data);
		if (json !== last) {
			last = json;
			yield data;
		}
		await nextTick(10_000);
	}
});

export const watchProject = query.live(projectName, async function* (name) {
	requireUserCommand();
	let last = '';
	while (true) {
		const data = await getProjectStatus(name);
		const json = JSON.stringify(data);
		if (json !== last) {
			last = json;
			yield data;
		}
		await nextTick(10_000);
	}
});

export const watchJobs = query.live(async function* () {
	requireUserCommand();
	while (true) {
		yield listJobs().slice(0, 30);
		await new Promise<void>((resolve) => {
			const t = setTimeout(done, 30_000);
			function done() {
				clearTimeout(t);
				jobEvents.off('change', on);
				resolve();
			}
			const on = (job: { output: string; status: string }) => {
				// output chunks don't change the summary
				if (job.status !== 'running' || job.output === '') done();
			};
			jobEvents.on('change', on);
		});
		await new Promise((r) => setTimeout(r, 150));
	}
});

export const watchJob = query.live(v.string(), async function* (id) {
	requireUserCommand();
	while (true) {
		const job = getJob(id);
		if (!job) {
			yield null;
			return;
		}
		yield { ...job };
		if (job.finishedAt) return;
		await new Promise<void>((resolve) => {
			const t = setTimeout(done, 15_000);
			function done() {
				clearTimeout(t);
				jobEvents.off(`job:${id}`, done);
				resolve();
			}
			jobEvents.on(`job:${id}`, done);
		});
		// batch output chunks
		await new Promise((r) => setTimeout(r, 120));
	}
});

export const watchLogs = query.live(
	v.object({ id: v.pipe(v.string(), v.regex(/^[a-f0-9]{12,64}$/)), tail: v.number() }),
	async function* ({ id, tail }) {
		requireUserCommand();
		const child = spawn('docker', ['logs', '-f', '-t', '--tail', String(Math.min(tail, 5000)), id]);
		let lines: string[] = [];
		let partial = '';
		let dirty = true;
		let closed = false;
		const onData = (chunk: Buffer) => {
			const text = partial + chunk.toString('utf8');
			const parts = text.split('\n');
			partial = parts.pop() ?? '';
			lines.push(...parts);
			if (lines.length > 2000) lines = lines.slice(-2000);
			dirty = true;
		};
		child.stdout.on('data', onData);
		child.stderr.on('data', onData);
		child.on('close', () => (closed = true));
		try {
			while (true) {
				if (dirty) {
					dirty = false;
					yield lines.join('\n');
				}
				if (closed) {
					await new Promise((r) => setTimeout(r, 2000));
					continue;
				}
				await new Promise((r) => setTimeout(r, 400));
			}
		} finally {
			child.kill();
		}
	}
);

export const getActivity = query(v.optional(v.string()), async (project) => {
	requireUser();
	const q = db.select().from(activity).orderBy(desc(activity.id)).limit(50);
	return project ? q.where(eq(activity.project, project)) : q;
});

// ---------------------------------------------------------------------------
// actions

export const projectAction = command(
	v.object({
		name: projectName,
		action: v.picklist(PROJECT_ACTIONS),
		services: v.optional(v.array(v.string()), [])
	}),
	async ({ name, action, services }) => {
		const me = requireUserCommand();
		const job = await runProjectAction(name, action, me.username, services);
		return job.id;
	}
);

export const containerAction = command(
	v.object({ id: v.string(), action: v.picklist(['start', 'stop', 'restart']) }),
	async ({ id, action }) => {
		const me = requireUserCommand();
		const job = await runContainerAction(id, action, me.username);
		return job.id;
	}
);

export const checkUpdates = command(v.optional(projectName), async (name) => {
	requireUserCommand();
	if (name) {
		const fresh = await checkUpdatesByName(name);
		return fresh.length;
	}
	await checkAllUpdates();
	return 0;
});

// ---------------------------------------------------------------------------
// files

export const getFiles = query(projectName, async (name) => {
	requireUser();
	return readProjectFiles(name);
});

export const validateFiles = command(
	v.object({ name: projectName, compose: v.string(), env: v.string() }),
	async ({ name, compose, env }) => {
		requireUserCommand();
		const restored = await restoreSecrets(name, env);
		if (restored.missing.length) return missingSecrets(restored.missing);
		return validateCompose(projectDir(name), compose, restored.env);
	}
);

export const saveFiles = command(
	v.object({
		name: projectName,
		compose: v.string(),
		env: v.string(),
		deploy: v.optional(v.boolean(), false)
	}),
	async ({ name, compose, env, deploy }) => {
		const me = requireUserCommand();
		await loadProject(name);
		const restored = await restoreSecrets(name, env);
		if (restored.missing.length) return { error: missingSecrets(restored.missing), jobId: null };
		const problem = await validateCompose(projectDir(name), compose, restored.env);
		if (problem) return { error: problem, jobId: null };
		await writeEnv(name, restored.env);
		await writeCompose(name, compose);
		await logActivity({
			project: name,
			type: 'edit',
			message: `Configuration saved by ${me.username}`
		});
		void getFiles(name).refresh();
		const jobId = deploy ? (await runProjectAction(name, 'up', me.username)).id : null;
		return { error: null, jobId };
	}
);

export const createProject = command(
	v.object({
		name: projectName,
		compose: v.pipe(v.string(), v.nonEmpty('The compose file must not be empty')),
		env: v.string(),
		deploy: v.optional(v.boolean(), false)
	}),
	async ({ name, compose, env, deploy }) => {
		const me = requireUserCommand();
		const dir = projectDir(name);
		const { missing } = unmaskEnv(env, '');
		if (missing.length) return { error: missingSecrets(missing), jobId: null };
		const problem = await validateCompose(dir, compose, env);
		if (problem) return { error: problem, jobId: null };
		await createProjectFolder(name, compose, env);
		await logActivity({
			project: name,
			type: 'create',
			level: 'success',
			message: `Created by ${me.username}`
		});
		const jobId = deploy ? (await runProjectAction(name, 'up', me.username)).id : null;
		return { error: null, jobId };
	}
);

export const saveMeta = command(
	v.object({
		name: projectName,
		description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200))),
		url: v.optional(v.union([v.literal(''), v.pipe(v.string(), v.trim(), v.url('Invalid url'))])),
		autoUpdate: v.boolean()
	}),
	async ({ name, ...meta }) => {
		requireUserCommand();
		await writeMeta(name, meta);
		void getFiles(name).refresh();
	}
);

export const deleteProject = command(
	v.object({ name: projectName, removeVolumes: v.boolean() }),
	async ({ name, removeVolumes }) => {
		const me = requireUserCommand();
		const project = await loadProject(name);
		if (project.isSelf) error(400, 'Dockit cannot delete itself');
		const job = startJob(name, 'Delete project', me.username, async (ctx) => {
			if (project.composeFile) {
				await ctx.exec(
					'docker',
					['compose', 'down', '--remove-orphans', ...(removeVolumes ? ['-v'] : [])],
					{
						cwd: project.dir
					}
				);
			}
			const target = await trashProject(name);
			ctx.log(`\nMoved project folder to ${target}\n`);
			await logActivity({
				project: name,
				type: 'delete',
				level: 'warning',
				message: `Deleted by ${me.username}`
			});
		});
		await waitForJob(job);
		if (job.status === 'failed') error(500, job.error ?? 'Delete failed');
		return job.id;
	}
);

// ---------------------------------------------------------------------------
// images & volumes

export const getResources = query(projectName, async (name) => {
	requireUser();
	return getProjectResources(name);
});

export const removeImage = command(
	v.object({ name: projectName, id: v.pipe(v.string(), v.regex(/^sha256:[a-f0-9]{64}$/)) }),
	async ({ name, id }) => {
		requireUserCommand();
		const res = await run('docker', ['image', 'rm', id]);
		if (res.code !== 0) error(400, res.stderr.trim() || 'Could not remove image');
		void getResources(name).refresh();
	}
);

export const removeVolume = command(
	v.object({
		name: projectName,
		volume: v.pipe(v.string(), v.regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/))
	}),
	async ({ name, volume }) => {
		requireUserCommand();
		const res = await run('docker', ['volume', 'rm', volume]);
		if (res.code !== 0) error(400, res.stderr.trim() || 'Could not remove volume');
		void getResources(name).refresh();
	}
);

export const pruneUnused = command(projectName, async (name) => {
	requireUserCommand();
	const { images } = await getProjectResources(name);
	let removed = 0;
	for (const img of images.filter((i) => !i.inUse)) {
		const res = await run('docker', ['image', 'rm', img.id]);
		if (res.code === 0) removed++;
	}
	void getResources(name).refresh();
	return removed;
});

export const getSystemInfo = query(async () => {
	requireUser();
	const res = await run('docker', ['version', '--format', '{{json .}}']);
	const containers = await listContainers().catch(() => []);
	let version: { client?: string; server?: string; compose?: string } = {};
	if (res.code === 0) {
		try {
			const j = JSON.parse(res.stdout);
			version = { client: j.Client?.Version, server: j.Server?.Version };
		} catch {
			/* ignore */
		}
	}
	const compose = await run('docker', ['compose', 'version', '--short']);
	version.compose = compose.stdout.trim();
	return {
		dockerOk: res.code === 0,
		dockerError: res.code === 0 ? null : res.stderr.trim(),
		version,
		containers: containers.length,
		running: containers.filter((c) => c.state === 'running').length,
		self: getSelf()?.project ?? null
	};
});
