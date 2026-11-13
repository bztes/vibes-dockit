<script lang="ts">
	import { getProxy } from '#lib/remote/caddy.remote.js';
	import Card from '#lib/components/ui/Card.svelte';
	import CaddySetup from '#lib/components/app/CaddySetup.svelte';
	import RouteEditor from './RouteEditor.svelte';

	let { name }: { name: string } = $props();

	const proxy = $derived(await getProxy(name));
	const isCaddy = $derived(proxy.caddy.project === name);
	// re-mount the editor whenever the stored routes change
	const key = $derived(JSON.stringify(proxy.services));
</script>

<Card
	title="Domains"
	description="Caddy routes these domains to the containers over the {proxy.caddy
		.network} network (automatic HTTPS) — no published ports needed. Stored as labels in the compose file."
>
	<div class="grid gap-5">
		<CaddySetup compact />
		{#if isCaddy}
			<p class="text-sm text-zinc-500">This project is the Caddy reverse proxy itself.</p>
		{:else if proxy.parseError}
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
