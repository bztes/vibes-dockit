import { error } from '@sveltejs/kit';
import { inspectContainers, listContainers, type Container } from './docker';
import { run } from './exec';
import { startJob, type JobContext } from './jobs';
import { loadProject, getRoot, projectNameFor, type ProjectInfo } from './projects';
import { getSelf, hostDockerSocket } from './self';
import { checkProjectUpdates } from './updates';
import { notify } from './notify';
import { logActivity } from './db';
import { getConfig } from './config';
import { ensureProjectNetwork } from './caddy';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const PROJECT_ACTIONS = ['up', 'down', 'stop', 'restart', 'pull', 'update'] as const;
export type ProjectAction = (typeof PROJECT_ACTIONS)[number];

const LABELS: Record<ProjectAction, string> = {
	up: 'Deploy',
	down: 'Down',
	stop: 'Stop',
	restart: 'Restart',
	pull: 'Pull images',
	update: 'Update'
};

export function containersOf(project: ProjectInfo, containers: Container[]) {
	return containers.filter((c) =>
		c.workingDir ? c.workingDir === project.dir : c.project === project.composeName
	);
}

/**
 * The dockit container can't recreate itself (it would be killed half way), so
 * the final `docker compose up` is delegated to a short-lived helper container
 * that uses the same image (it contains the docker cli).
 */
async function selfUp(ctx: JobContext, project: ProjectInfo, args: string[]) {
	const self = getSelf();
	if (!self?.imageId) {
		throw new Error('Cannot update dockit itself: own container/image could not be detected');
	}
	const root = getRoot();
	ctx.log('Dockit is updating itself. A helper container recreates the dockit container.\n');
	ctx.log('The UI will be unavailable for a few seconds.\n');
	await ctx.exec('docker', [
		'run',
		'-d',
		'--rm',
		'--name',
		`dockit-self-update-${Date.now()}`,
		'--label',
		'dockit.helper=true',
		'-v',
		`${hostDockerSocket()}:/var/run/docker.sock`,
		'-v',
		`${root}:${root}`,
		'-w',
		project.dir,
		'--entrypoint',
		'sh',
		self.imageId,
		'-c',
		`sleep 3 && docker compose ${args.join(' ')}`
	]);
}

async function usedImageIds(project: ProjectInfo) {
	const ids = containersOf(project, await listContainers()).map((c) => c.id);
	return new Set((await inspectContainers(ids)).map((c) => c.imageId));
}

async function pruneOldImages(ctx: JobContext, before: Set<string>, project: ProjectInfo) {
	const after = await usedImageIds(project);
	const all = await listContainers();
	const stillUsed = new Set((await inspectContainers(all.map((c) => c.id))).map((c) => c.imageId));
	for (const id of before) {
		if (after.has(id) || stillUsed.has(id)) continue;
		ctx.log(`Removing old image ${id.slice(7, 19)}\n`);
		await run('docker', ['image', 'rm', id]);
	}
}

export async function runProjectAction(
	name: string,
	action: ProjectAction,
	user: string | null,
	services: string[] = []
) {
	const project = await loadProject(name);
	if (!project.composeFile) error(400, 'Project has no compose file');
	if (project.isSelf && (action === 'down' || action === 'stop') && services.length === 0) {
		error(400, 'Dockit cannot stop itself. Use the terminal for that.');
	}

	const label = services.length ? `${LABELS[action]} ${services.join(', ')}` : LABELS[action];

	return startJob(project.name, label, user, async (ctx) => {
		const dc = (args: string[]) => ctx.exec('docker', ['compose', ...args], { cwd: project.dir });
		const upArgs = ['up', '-d', '--remove-orphans', ...services];
		try {
			if (action === 'up' || action === 'update' || action === 'restart') {
				// the external caddy network has to exist before compose can attach to it
				const source = await readFile(path.join(project.dir, project.composeFile!), 'utf8');
				await ensureProjectNetwork(source, ctx.log);
			}
			switch (action) {
				case 'up':
					if (project.isSelf && services.length === 0) await selfUp(ctx, project, upArgs);
					else await dc(upArgs);
					// images may have been pulled for the first time
					await checkProjectUpdates(project, { silent: true }).catch(() => {});
					break;
				case 'down':
					await dc(['down', ...services]);
					break;
				case 'stop':
					await dc(['stop', ...services]);
					break;
				case 'restart':
					if (project.isSelf && services.length === 0) await selfUp(ctx, project, ['restart']);
					else await dc(['restart', ...services]);
					break;
				case 'pull':
					await dc(['pull', ...services]);
					await checkProjectUpdates(project, { silent: true }).catch(() => {});
					break;
				case 'update': {
					const before = await usedImageIds(project);
					await dc(['pull', ...services]);
					if (project.isSelf) {
						await selfUp(ctx, project, upArgs);
					} else {
						await dc(upArgs);
						if (getConfig().pruneImagesAfterUpdate) await pruneOldImages(ctx, before, project);
					}
					await checkProjectUpdates(project, { silent: true }).catch(() => {});
					ctx.log('\n\x1b[32m✔ Update finished\x1b[0m\n');
					await notify({
						type: 'update_success',
						project: project.name,
						title: `${project.name} was updated`,
						message: `Pulled the latest images and recreated the containers${user ? ` (by ${user})` : ''}.`
					});
					break;
				}
			}
			if (action !== 'update') {
				await logActivity({
					project: project.name,
					type: action,
					level: 'success',
					message: `${label}${user ? ` by ${user}` : ''}`
				});
			}
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			await notify({
				type: action === 'update' ? 'update_failed' : 'action_failed',
				project: project.name,
				title: `${label} of ${project.name} failed`,
				// eslint-disable-next-line no-control-regex
				message: `${message}\n\n${ctx.job.output.replace(/\x1b\[[0-9;]*m/g, '').slice(-1500)}`
			});
			throw e;
		}
	});
}

export async function runContainerAction(
	id: string,
	action: 'start' | 'stop' | 'restart',
	user: string | null
) {
	const container = (await listContainers()).find((c) => c.id === id || c.id.startsWith(id));
	if (!container) error(404, 'Container not found');
	const self = getSelf();
	if (self?.containerId === container.id && action !== 'start') {
		error(400, 'Dockit cannot stop or restart its own container');
	}
	return startJob(projectNameFor(container), `${action} ${container.name}`, user, async (ctx) => {
		await ctx.exec('docker', [action, container.id]);
	});
}
