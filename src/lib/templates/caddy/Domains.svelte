<script lang="ts">
	import { CirclePause } from '@lucide/svelte';
	import { getProxy } from './caddy.remote';
	import Card from '#lib/components/ui/Card.svelte';
	import RouteEditor from './RouteEditor.svelte';

	let { name }: { name: string } = $props();

	const proxy = $derived(await getProxy(name));
	const caddy = $derived(proxy.caddy);
	// re-mount the editor whenever the stored routes change
	const key = $derived(JSON.stringify(proxy.services));
</script>

<Card
	title="Domains"
	description="Caddy routes these domains to the containers over the {caddy.network} network (automatic HTTPS) — no published ports needed. Stored as labels in the compose file."
>
	<div class="grid gap-5">
		{#if caddy.state === 'stopped'}
			<div
				class="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"
			>
				<CirclePause class="mt-0.5 size-4 shrink-0 text-amber-500" />
				<div>
					<p class="font-medium">Caddy is not running</p>
					<p class="mt-0.5 text-zinc-500">
						The container <code class="font-mono text-xs">{caddy.container?.name}</code> is {caddy
							.container?.state}. Domains are applied as soon as it runs again.
						{#if caddy.project}
							<a href="/projects/{caddy.project}" class="text-link hover:underline">Open project</a>
						{/if}
					</p>
				</div>
			</div>
		{/if}
		{#if proxy.parseError}
			<p class="text-sm text-red-600 dark:text-red-400">
				The compose file could not be parsed: {proxy.parseError}
			</p>
		{:else}
			{#key key}
				<RouteEditor {name} services={proxy.services} />
			{/key}
		{/if}
	</div>
</Card>
