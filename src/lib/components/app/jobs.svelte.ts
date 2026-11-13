/** global state for the job output panel */
export const jobPanel = $state<{ id: string | null; minimized: boolean }>({
	id: null,
	minimized: false
});

export function openJob(id: string) {
	jobPanel.id = id;
	jobPanel.minimized = false;
}
