import { error } from '@sveltejs/kit';
import { inspectContainers, listContainers, type Container } from './docker';
import { run } from './exec';
import { startJob, type JobContext } from './jobs';
import { loadProject, projectNameFor, type ProjectInfo } from './projects';
import { getSelf } from './self';
import { checkProjectUpdates } from './updates';
import { notify, notifyJobFailed } from './notify';
import { logActivity } from './db';
import { getConfig } from './config';
import { beforeAction, beforeUp } from './templates';

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

const SELF_ERROR =
	'Dockit cannot run docker commands on its own project. Use the terminal for that.';

export function containersOf(project: ProjectInfo, containers: Container[]) {
	return containers.filter((c) =>
		c.workingDir ? c.workingDir === project.dir : c.project === project.composeName
	);
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
	// pulling is fine, it doesn't touch the running container
	if (project.isSelf && action !== 'pull') error(400, SELF_ERROR);

	const label = services.length ? `${LABELS[action]} ${services.join(', ')}` : LABELS[action];

	return startJob(project.name, label, user, async (ctx) => {
		const dc = (args: string[]) => ctx.exec('docker', ['compose', ...args], { cwd: project.dir });
		const upArgs = ['up', '-d', '--remove-orphans', ...services];
		try {
			// e.g. the restic template backs up before an update
			await beforeAction(project, action, ctx);
			if (action === 'up' || action === 'update' || action === 'restart') {
				// templates prepare host resources, e.g. the external caddy network
				await beforeUp(project, ctx.log);
			}
			switch (action) {
				case 'up':
					await dc(upArgs);
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
					await dc(['restart', ...services]);
					break;
				case 'pull':
					await dc(['pull', ...services]);
					await checkProjectUpdates(project, { silent: true }).catch(() => {});
					break;
				case 'update': {
					const before = await usedImageIds(project);
					await dc(['pull', ...services]);
					await dc(upArgs);
					if (getConfig().pruneImagesAfterUpdate) await pruneOldImages(ctx, before, project);
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
			await notifyJobFailed(ctx, action === 'update' ? 'update_failed' : 'action_failed', label, e);
			throw e;
		}
	});
}

export const CONTAINER_ACTIONS = ['start', 'stop', 'restart', 'pause', 'unpause', 'kill'] as const;
export type ContainerAction = (typeof CONTAINER_ACTIONS)[number];

export async function runContainerAction(id: string, action: ContainerAction, user: string | null) {
	const container = (await listContainers()).find((c) => c.id === id || c.id.startsWith(id));
	if (!container) error(404, 'Container not found');
	if (projectNameFor(container) === getSelf()?.project) error(400, SELF_ERROR);
	return startJob(projectNameFor(container), `${action} ${container.name}`, user, async (ctx) => {
		await ctx.exec('docker', [action, container.id]);
	});
}
