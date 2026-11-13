<script lang="ts">
	import Badge from '#lib/components/ui/Badge.svelte';
	import StatusDot from '#lib/components/ui/StatusDot.svelte';

	type State = 'running' | 'partial' | 'stopped' | 'unhealthy' | 'not-deployed';
	let { state, running, total }: { state: State; running: number; total: number } = $props();

	const labels: Record<State, string> = {
		running: 'Running',
		partial: 'Partially running',
		stopped: 'Stopped',
		unhealthy: 'Unhealthy',
		'not-deployed': 'Not deployed'
	};
	const tones = {
		running: 'success',
		partial: 'warning',
		stopped: 'neutral',
		unhealthy: 'danger',
		'not-deployed': 'neutral'
	} as const;
</script>

<Badge tone={tones[state]}>
	<StatusDot tone={state} pulse={state === 'unhealthy'} />
	{labels[state]}
	{#if total > 0 && state !== 'running'}<span class="opacity-70">{running}/{total}</span>{/if}
</Badge>
