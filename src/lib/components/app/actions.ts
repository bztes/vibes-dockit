import { checkUpdates, projectAction } from '#lib/remote/projects.remote.js';
import { toast } from '#lib/components/ui/toast.svelte.js';
import { confirm } from '#lib/components/ui/confirm.svelte.js';
import { openJob } from './jobs.svelte';

type Action = 'up' | 'down' | 'stop' | 'restart' | 'pull' | 'update';

const CONFIRM: Partial<Record<Action, string>> = {
	down: 'This stops and removes all containers and networks of the project. Volumes are kept.',
	stop: 'All containers of this project will be stopped.'
};

export async function runAction(name: string, action: Action, services: string[] = []) {
	const text = CONFIRM[action];
	if (text && services.length === 0) {
		const ok = await confirm({
			title: `${action === 'down' ? 'Take down' : 'Stop'} ${name}?`,
			description: text,
			confirmLabel: action === 'down' ? 'Take down' : 'Stop',
			danger: true
		});
		if (!ok) return;
	}
	try {
		const id = await projectAction({ name, action, services });
		openJob(id);
	} catch (e) {
		toast.error(`Could not ${action} ${name}`, e);
	}
}

export async function runCheckUpdates(name?: string) {
	try {
		const fresh = await checkUpdates(name);
		if (name) toast.success(fresh ? `${fresh} new update(s) found` : 'Update check finished');
		else toast.success('Update check finished');
	} catch (e) {
		toast.error('Update check failed', e);
	}
}
