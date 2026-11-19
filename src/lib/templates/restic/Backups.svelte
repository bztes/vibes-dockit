<script lang="ts">
	import { CircleAlert, CirclePause, LoaderCircle } from '@lucide/svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import { getBackup } from './restic.remote';
	import BackupSettings from './BackupSettings.svelte';
	import Hooks from './Hooks.svelte';
	import Snapshots from './Snapshots.svelte';

	let { name }: { name: string } = $props();

	const backup = $derived(await getBackup(name));
	const restic = $derived(backup.restic);
	// re-mount the editor whenever the stored settings change
	const key = $derived(JSON.stringify([backup.settings, backup.volumes]));
</script>

<div class="grid gap-5">
	{#if restic.state === 'stopped'}
		<div
			class="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"
		>
			<CirclePause class="mt-0.5 size-4 shrink-0 text-amber-500" />
			<div>
				<p class="font-medium">Restic is not running</p>
				<p class="mt-0.5 text-zinc-500">
					{#if restic.container}
						The container <code class="font-mono text-xs">{restic.container.name}</code> is
						{restic.container.state}.
					{:else}
						The restic project is not deployed.
					{/if}
					No backups run until it is started.
					{#if restic.project}
						<a href="/projects/{restic.project}" class="text-link hover:underline">Open project</a>
					{/if}
				</p>
			</div>
		</div>
	{/if}
	{#if restic.error}
		<div
			class="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm"
		>
			<CircleAlert class="mt-0.5 size-4 shrink-0 text-red-500" />
			<div class="min-w-0">
				<p class="font-medium">The backups could not be scheduled</p>
				<p class="mt-0.5 text-zinc-500">
					Check <code class="font-mono text-xs">conf/profiles.yaml</code>
					{#if restic.project}
						in <a href="/projects/{restic.project}" class="text-link hover:underline"
							>{restic.project}</a
						>{/if}.
				</p>
				<pre
					class="mt-2 overflow-x-auto font-mono text-xs whitespace-pre-wrap text-red-600 dark:text-red-400">{restic.error}</pre>
			</div>
		</div>
	{/if}

	{#if backup.parseError}
		<p class="text-sm text-red-600 dark:text-red-400">
			The compose file could not be parsed: {backup.parseError}
		</p>
	{:else}
		{#key key}
			<BackupSettings {name} settings={backup.settings} volumes={backup.volumes} dir={backup.dir} />
		{/key}
		<Hooks {name} runners={backup.hooks.runners} candidates={backup.hooks.candidates} />
		{#if restic.state === 'ready'}
			<!-- the repository can be slow or unreachable: don't hold back the settings -->
			<svelte:boundary>
				<Snapshots
					{name}
					dir={backup.dir}
					enabled={backup.settings !== null}
					canRestore={!backup.isSelf}
					hooks={backup.hooks.runners.length > 0}
				/>
				{#snippet pending()}
					<Card title="Snapshots" description="Backups of this project in the restic repository.">
						<div class="flex items-center gap-2 text-sm text-zinc-500">
							<LoaderCircle class="size-4 animate-spin" /> Reading the repository…
						</div>
					</Card>
				{/snippet}
			</svelte:boundary>
		{/if}
	{/if}
</div>
