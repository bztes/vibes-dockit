<script lang="ts">
	import { CircleAlert, CirclePause } from '@lucide/svelte';
	import { getProxy } from './caddy.remote';
	import Card from '#lib/components/ui/Card.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import ErrorOutput from '#lib/components/ui/ErrorOutput.svelte';
	import RouteEditor from './RouteEditor.svelte';

	let { name }: { name: string } = $props();

	const proxy = $derived(await getProxy(name));
	const caddy = $derived(proxy.caddy);
	// re-mount the editor whenever the stored routes change
	const key = $derived(JSON.stringify(proxy.services.map((s) => s.routes)));
</script>

<Card
	title="Domains"
	description="Caddy routes these domains to the containers over the {caddy.network} network with automatic HTTPS — no published ports needed. Changes apply right away, containers keep running."
>
	<div class="grid gap-5">
		{#if caddy.state === 'stopped'}
			<Alert icon={CirclePause} title="Caddy is not running">
				{#if caddy.container}
					The container <code class="font-mono text-xs">{caddy.container.name}</code> is
					{caddy.container.state}.
				{:else}
					The caddy project is not deployed.
				{/if}
				Domains are applied as soon as it runs.
				{#if caddy.project}
					<a href="/projects/{caddy.project}" class="text-link hover:underline">Open project</a>
				{/if}
			</Alert>
		{/if}
		{#if caddy.error}
			<Alert tone="danger" icon={CircleAlert} title="Caddy rejected its configuration">
				It keeps running with the last working one. Check
				<code class="font-mono text-xs">conf/Caddyfile</code>
				{#if caddy.project}
					in <a href="/projects/{caddy.project}" class="text-link hover:underline"
						>{caddy.project}</a
					>{/if}.
				<ErrorOutput plain class="mt-2" text={caddy.error} />
			</Alert>
		{/if}
		{#if proxy.parseError}
			<p class="text-sm text-red-600 dark:text-red-400">
				The compose file could not be parsed: {proxy.parseError}
			</p>
		{:else}
			{#key key}
				<RouteEditor {name} services={proxy.services} network={caddy.network} />
			{/key}
		{/if}
	</div>
</Card>
