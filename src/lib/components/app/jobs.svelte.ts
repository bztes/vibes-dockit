/** global state for the job output panel, one tab per open job */
export const jobPanel = $state<{ ids: string[]; active: string | null; minimized: boolean }>({
	ids: [],
	active: null,
	minimized: false
});

export function openJob(id: string) {
	if (!jobPanel.ids.includes(id)) jobPanel.ids.push(id);
	jobPanel.active = id;
	jobPanel.minimized = false;
}

export function closeJob(id: string) {
	const i = jobPanel.ids.indexOf(id);
	if (i === -1) return;
	jobPanel.ids.splice(i, 1);
	if (jobPanel.active === id) {
		jobPanel.active = jobPanel.ids[Math.min(i, jobPanel.ids.length - 1)] ?? null;
	}
}

export function closeAll() {
	jobPanel.ids = [];
	jobPanel.active = null;
}
