import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { invalidateContainers } from './docker';
import { notify } from './notify';
import { projectNameFor } from './projects';

/**
 * Follows `docker events` to
 *  - push live status updates to the UI (`changes` emitter)
 *  - detect crashed / unhealthy containers for notifications
 */
export const changes = new EventEmitter();
changes.setMaxListeners(0);

interface DockerEvent {
	Action: string;
	Actor: { ID: string; Attributes: Record<string, string> };
	time: number;
}

const recentKills = new Map<string, number>();
const lastNotified = new Map<string, number>();
const THROTTLE = 10 * 60_000;

let child: ChildProcess | null = null;
let debounce: NodeJS.Timeout | undefined;
let stopped = false;

function changed() {
	invalidateContainers();
	clearTimeout(debounce);
	debounce = setTimeout(() => changes.emit('change'), 300);
}

/** Waits for the next container change (or the timeout). */
export function nextChange(timeout: number) {
	return new Promise<void>((resolve) => {
		const t = setTimeout(done, timeout);
		function done() {
			clearTimeout(t);
			changes.off('change', done);
			resolve();
		}
		changes.on('change', done);
	});
}

function throttled(key: string) {
	const last = lastNotified.get(key) ?? 0;
	if (Date.now() - last < THROTTLE) return true;
	lastNotified.set(key, Date.now());
	return false;
}

async function handle(event: DockerEvent) {
	const attrs = event.Actor.Attributes ?? {};
	const id = event.Actor.ID;
	const name = attrs.name ?? id.slice(0, 12);
	if (attrs['dockit.helper']) return;
	const project = projectNameFor({
		workingDir: attrs['com.docker.compose.project.working_dir'],
		project: attrs['com.docker.compose.project'],
		name
	});

	if (event.Action === 'kill' || event.Action === 'stop') {
		recentKills.set(id, Date.now());
		return;
	}

	if (event.Action === 'die') {
		const exitCode = Number(attrs.exitCode ?? 0);
		const killedAt = recentKills.get(id);
		recentKills.delete(id);
		const intentional = killedAt !== undefined && Date.now() - killedAt < 60_000;
		if (exitCode === 0 || intentional) return;
		if (throttled(`die:${name}`)) return;
		await notify({
			type: 'container_died',
			project,
			title: `${name} crashed`,
			message: `Container ${name} (${attrs.image}) exited with code ${exitCode}.`
		});
		return;
	}

	if (event.Action.startsWith('health_status') && event.Action.includes('unhealthy')) {
		if (throttled(`unhealthy:${name}`)) return;
		await notify({
			type: 'container_unhealthy',
			project,
			title: `${name} is unhealthy`,
			message: `The health check of ${name} (${attrs.image}) is failing.`
		});
	}

	if (event.Action === 'oom') {
		if (throttled(`oom:${name}`)) return;
		await notify({
			type: 'container_died',
			project,
			title: `${name} ran out of memory`,
			message: `Container ${name} (${attrs.image}) was killed by the OOM killer.`
		});
	}
}

export function startMonitor() {
	if (child) return;
	stopped = false;
	child = spawn('docker', ['events', '--format', '{{json .}}', '--filter', 'type=container']);
	let buffer = '';
	child.stdout!.setEncoding('utf8');
	child.stdout!.on('data', (chunk: string) => {
		buffer += chunk;
		let i: number;
		while ((i = buffer.indexOf('\n')) !== -1) {
			const line = buffer.slice(0, i).trim();
			buffer = buffer.slice(i + 1);
			if (!line) continue;
			try {
				const event = JSON.parse(line) as DockerEvent;
				if (!event.Action.startsWith('exec_')) changed();
				handle(event).catch((e) => console.error('[dockit] monitor', e));
			} catch {
				/* ignore malformed lines */
			}
		}
	});
	child.on('error', () => {});
	child.on('close', () => {
		child = null;
		if (!stopped) setTimeout(startMonitor, 5000);
	});

	// clean up stale kill markers
	setInterval(() => {
		const now = Date.now();
		for (const [id, t] of recentKills) if (now - t > 120_000) recentKills.delete(id);
	}, 60_000).unref();
}

export function stopMonitor() {
	stopped = true;
	child?.kill();
}
