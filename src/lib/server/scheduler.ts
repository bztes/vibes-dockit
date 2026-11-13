import { getConfig } from './config';
import { runProjectAction } from './actions';
import { checkAllUpdates, lastFullCheck } from './updates';

let timer: NodeJS.Timeout | undefined;
let startedAt = Date.now();

/** Periodically checks for image updates and runs auto updates. */
export function startScheduler() {
	if (timer) return;
	startedAt = Date.now();
	timer = setInterval(tick, 60_000);
	timer.unref();
	// first check shortly after startup
	setTimeout(tick, 30_000).unref();
}

async function tick() {
	const hours = getConfig().updateCheckIntervalHours;
	if (!hours || hours <= 0) return;
	const last = lastFullCheck?.getTime() ?? startedAt - hours * 3600_000;
	if (Date.now() - last < hours * 3600_000) return;
	await checkAllUpdates((project) => {
		if (project.meta.autoUpdate) {
			runProjectAction(project.name, 'update', 'auto-update').catch((e) =>
				console.error(`[dockit] auto update of ${project.name} failed`, e)
			);
		}
	});
}
