import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { JobContext } from './jobs';
import { getRoot, type ProjectInfo } from './projects';
import { getSelf, hostDockerSocket } from './self';
import { notify } from './notify';
import { logActivity } from './db';

/**
 * The dockit container can't recreate itself (it would be killed half way), so
 * the final `docker compose` call is delegated to a short-lived helper container
 * that uses the same image (it contains the docker cli).
 *
 * The helper writes its output and exit code into the project folder. Whoever
 * is still alive reports the result: the old instance when compose fails before
 * it is stopped, otherwise the new instance at startup.
 */

const PENDING = '.dockit-self-update.json';
const LOG = '.dockit-self-update.log';
const EXIT = '.dockit-self-update.exit';

interface Pending {
	action: 'up' | 'restart' | 'update';
	user: string | null;
	startedAt: string;
}

const files = (dir: string) => ({
	pending: path.join(dir, PENDING),
	log: path.join(dir, LOG),
	exit: path.join(dir, EXIT)
});

async function cleanup(dir: string) {
	const f = files(dir);
	await Promise.all([f.pending, f.log, f.exit].map((p) => rm(p, { force: true })));
}

async function readResult(dir: string) {
	const f = files(dir);
	if (!existsSync(f.exit)) return null;
	const code = Number((await readFile(f.exit, 'utf8')).trim());
	const output = existsSync(f.log) ? await readFile(f.log, 'utf8') : '';
	return { code: Number.isNaN(code) ? -1 : code, output };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function selfUp(
	ctx: JobContext,
	project: ProjectInfo,
	action: Pending['action'],
	user: string | null,
	args: string[]
) {
	const self = getSelf();
	if (!self?.imageId) {
		throw new Error('Cannot update dockit itself: own container/image could not be detected');
	}
	if (!self.dockerSocket) {
		ctx.log(
			`\x1b[33mHost path of the docker socket is unknown, falling back to ${hostDockerSocket()}\x1b[0m\n`
		);
	}
	const root = getRoot();
	const f = files(project.dir);
	await cleanup(project.dir);
	const pending: Pending = { action, user, startedAt: new Date().toISOString() };
	await writeFile(f.pending, JSON.stringify(pending));

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
		'-e',
		`DOCKIT_LOG=${f.log}`,
		'-e',
		`DOCKIT_EXIT=${f.exit}`,
		'--entrypoint',
		'sh',
		self.imageId,
		'-c',
		`sleep 3; docker compose ${args.join(' ')} > "$DOCKIT_LOG" 2>&1; echo $? > "$DOCKIT_EXIT"`
	]);

	// usually this process gets stopped while waiting, the new instance reports then
	const deadline = Date.now() + 120_000;
	while (Date.now() < deadline) {
		await sleep(1000);
		const result = await readResult(project.dir);
		if (!result) continue;
		await cleanup(project.dir);
		ctx.log(result.output);
		if (result.code !== 0) {
			throw new Error(
				`docker compose ${args[0]} in the helper failed with exit code ${result.code}`
			);
		}
		// compose succeeded without replacing this container (e.g. nothing changed)
		return;
	}
	await cleanup(project.dir);
	throw new Error('The helper container did not finish within 2 minutes');
}

/** Called at startup: reports the result of a self update started by the previous instance. */
export async function finishSelfUpdate() {
	const self = getSelf();
	if (!self?.project) return;
	const dir = path.join(getRoot(), self.project);
	if (!existsSync(files(dir).pending)) return;

	let pending: Pending;
	try {
		pending = JSON.parse(await readFile(files(dir).pending, 'utf8'));
	} catch {
		await cleanup(dir);
		return;
	}
	// `up -d` returns once the new container runs, the exit code may follow a moment later
	let result = await readResult(dir);
	for (let i = 0; !result && i < 30; i++) {
		await sleep(1000);
		result = await readResult(dir);
	}
	await cleanup(dir);

	const by = pending.user ? ` (by ${pending.user})` : '';
	if (result?.code === 0) {
		if (pending.action === 'update') {
			await notify({
				type: 'update_success',
				project: self.project,
				title: `${self.project} was updated`,
				message: `Pulled the latest images and recreated the containers${by}.`
			});
		} else {
			await logActivity({
				project: self.project,
				type: pending.action,
				level: 'success',
				message: `${pending.action === 'up' ? 'Deploy' : 'Restart'}${pending.user ? ` by ${pending.user}` : ''}`
			});
		}
		return;
	}
	const message = result
		? `docker compose failed with exit code ${result.code}\n\n${result.output.slice(-1500)}`
		: 'The helper container did not report a result';
	await notify({
		type: pending.action === 'update' ? 'update_failed' : 'action_failed',
		project: self.project,
		title: `${pending.action === 'update' ? 'Update' : pending.action} of ${self.project} failed`,
		message
	});
}
