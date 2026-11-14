<script lang="ts">
	import { CircleAlert, CirclePause } from '@lucide/svelte';
	import { getProxy } from './caddy.remote';
	import Card from '#lib/components/ui/Card.svelte';
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
			<div
				class="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"
			>
				<CirclePause class="mt-0.5 size-4 shrink-0 text-amber-500" />
				<div>
					<p class="font-medium">Caddy is not running</p>
					<p class="mt-0.5 text-zinc-500">
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
					</p>
				</div>
			</div>
		{/if}
		{#if caddy.error}
			<div
				class="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm"
			>
				<CircleAlert class="mt-0.5 size-4 shrink-0 text-red-500" />
				<div class="min-w-0">
					<p class="font-medium">Caddy rejected its configuration</p>
					<p class="mt-0.5 text-zinc-500">
						It keeps running with the last working one. Check
						<code class="font-mono text-xs">conf/Caddyfile</code>
						{#if caddy.project}
							in <a href="/projects/{caddy.project}" class="text-link hover:underline"
								>{caddy.project}</a
							>{/if}.
					</p>
					<pre
						class="mt-2 overflow-x-auto font-mono text-xs whitespace-pre-wrap text-red-600 dark:text-red-400">{caddy.error}</pre>
				</div>
			</div>
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
