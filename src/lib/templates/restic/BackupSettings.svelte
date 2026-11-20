<script lang="ts">
	import { Save } from '@lucide/svelte';
	import { saveBackup } from './restic.remote';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Input from '#lib/components/ui/Input.svelte';
	import Switch from '#lib/components/ui/Switch.svelte';
	import Textarea from '#lib/components/ui/Textarea.svelte';
	import { toast } from '#lib/components/ui/toast.svelte.js';
	import { DEFAULT_SETTINGS, type ResticSettings } from './restic';

	let {
		name,
		settings,
		volumes,
		dir
	}: { name: string; settings: ResticSettings | null; volumes: string[]; dir: string } = $props();

	// the parent re-mounts this component when the stored settings change
	// svelte-ignore state_referenced_locally
	const initial = settings ?? DEFAULT_SETTINGS;
	// svelte-ignore state_referenced_locally
	let enabled = $state(settings !== null);
	let schedule = $state(initial.schedule);
	let beforeUpdate = $state(initial.beforeUpdate);
	let exclude = $state(initial.exclude.join('\n'));
	// excluded volumes that don't exist (anymore) stay in the list
	// svelte-ignore state_referenced_locally
	const allVolumes = [...new Set([...volumes, ...initial.excludeVolumes])].sort();
	let included = $state(
		Object.fromEntries(allVolumes.map((v) => [v, !initial.excludeVolumes.includes(v)]))
	);
	let saving = $state(false);
	let problem = $state<string | null>(null);

	const draft = $derived<ResticSettings | null>(
		enabled
			? {
					schedule: schedule.trim(),
					exclude: exclude
						.split('\n')
						.map((l) => l.trim())
						.filter(Boolean),
					excludeVolumes: allVolumes.filter((v) => !included[v]),
					beforeUpdate
				}
			: null
	);
	// svelte-ignore state_referenced_locally
	const stored = JSON.stringify(settings);
	const dirty = $derived(JSON.stringify(draft) !== stored);

	async function save() {
		saving = true;
		problem = null;
		try {
			const res = await saveBackup({ name, settings: draft });
			if (res.error) problem = res.error;
			else toast.success(draft ? 'Backup settings saved' : 'Backups disabled');
		} catch (e) {
			toast.error('Could not save the backup settings', e);
		} finally {
			saving = false;
		}
	}
</script>

<Card
	title="Backup settings"
	description="The project folder and its volumes are backed up incrementally with restic. Stored in dockit.json."
>
	<div class="grid gap-5">
		<Switch
			bind:checked={enabled}
			label="Back up this project"
			description="Adds a resticprofile profile for this project."
		/>

		{#if enabled}
			<div class="grid gap-5 md:grid-cols-2">
				<Field
					label="Schedule"
					hint="resticprofile syntax, e.g. daily, hourly, *-*-* 03:00 or Mon..Fri 22:30. Empty = manual backups only."
					for="restic-schedule"
				>
					<Input id="restic-schedule" bind:value={schedule} placeholder="daily" mono />
				</Field>
				<div class="md:pt-7">
					<Switch
						bind:checked={beforeUpdate}
						label="Back up before updates"
						description="Also before auto updates. The update is cancelled when the backup fails."
					/>
				</div>
			</div>

			<Field
				label="Exclude"
				hint="restic exclude patterns, one per line. A leading / is the project folder ({dir}), e.g. /logs or *.tmp."
				for="restic-exclude"
			>
				<Textarea
					id="restic-exclude"
					bind:value={exclude}
					rows={4}
					placeholder="/logs&#10;*.tmp"
					mono
				/>
			</Field>

			<div class="grid gap-2">
				<p class="text-sm font-medium text-zinc-700 dark:text-zinc-300">Volumes</p>
				{#if allVolumes.length === 0}
					<p class="text-xs text-zinc-500">
						This project has no volumes (yet). Volumes show up here once they were created by a
						deploy.
					</p>
				{:else}
					<div class="grid gap-2 sm:grid-cols-2">
						{#each allVolumes as volume (volume)}
							<Switch
								bind:checked={included[volume]}
								label={volume}
								description={volumes.includes(volume) ? undefined : 'does not exist'}
							/>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		{#if problem}
			<pre
				class="rounded-lg bg-red-500/5 p-3 font-mono text-xs whitespace-pre-wrap text-red-600 dark:text-red-400">{problem}</pre>
		{/if}

		<div class="flex justify-end border-t border-zinc-100 pt-4 dark:border-zinc-800/60">
			<Button variant="primary" onclick={save} loading={saving} disabled={!dirty || saving}
				><Save /> Save</Button
			>
		</div>
	</div>
</Card>
