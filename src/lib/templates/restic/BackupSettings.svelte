<script lang="ts">
	import { FolderSearch, Save } from '@lucide/svelte';
	import { checkExclude, saveBackup } from './restic.remote';
	import ExcludePicker from './ExcludePicker.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import ErrorOutput from '#lib/components/ui/ErrorOutput.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Input from '#lib/components/ui/Input.svelte';
	import Switch from '#lib/components/ui/Switch.svelte';
	import CodeEditor, { type LineNote } from '#lib/components/ui/CodeEditor.svelte';
	import StaleDraft from '#lib/components/app/StaleDraft.svelte';
	import { draftKey, useDraft, type Draft } from '#lib/components/app/drafts.svelte.js';
	import { toast } from '#lib/components/ui/toast.svelte.js';
	import { DEFAULT_SETTINGS, patternPath, type ResticSettings } from './restic';

	let {
		name,
		settings,
		volumes,
		dir
	}: { name: string; settings: ResticSettings | null; volumes: string[]; dir: string } = $props();

	// the parent re-mounts this component when the stored settings change
	// svelte-ignore state_referenced_locally
	const initial = settings ?? DEFAULT_SETTINGS;
	// excluded volumes that don't exist (anymore) stay in the list
	// svelte-ignore state_referenced_locally
	const allVolumes = [...new Set([...volumes, ...initial.excludeVolumes])].sort();
	const fields = () => ({
		enabled: settings !== null,
		schedule: initial.schedule,
		beforeUpdate: initial.beforeUpdate,
		exclude: initial.exclude.join('\n'),
		included: Object.fromEntries(allVolumes.map((v) => [v, !initial.excludeVolumes.includes(v)]))
	});
	// svelte-ignore state_referenced_locally
	const stored = JSON.stringify(settings);
	// svelte-ignore state_referenced_locally
	const unsaved: Draft<ReturnType<typeof fields>> = useDraft(draftKey(name, 'backups'), {
		base: () => stored,
		dirty: () => dirty,
		value: () => form
	});
	const start = fields();
	const saved = unsaved.saved;
	let form = $state({
		...start,
		...saved,
		// volumes created since the draft started are included, like new ones are
		included: { ...start.included, ...saved?.included }
	});
	let saving = $state(false);
	let problem = $state<string | null>(null);

	const patterns = $derived(
		form.exclude
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean)
	);

	// what the patterns match, checked a moment after typing stops
	let checked = $state.raw<string[]>([]);
	$effect(() => {
		const next = patterns;
		const timer = setTimeout(() => (checked = next), 400);
		return () => clearTimeout(timer);
	});
	const check = $derived(
		form.enabled && checked.length ? checkExclude({ name, patterns: checked }) : null
	);
	/** the check result after the end of each line (until edited again) */
	const notes = $derived.by(() => {
		const results = check?.current?.results;
		if (!results || checked !== patterns) return undefined;
		let i = 0;
		return form.exclude.split('\n').map((line): LineNote | null => {
			if (!line.trim()) return null;
			const m = results[i++];
			if (m.all) return { text: 'excludes everything', tone: 'warn' };
			if (!m.first) return { text: 'matches nothing', tone: 'warn' };
			return { text: `✓ ${m.first}${m.count > 1 ? ` +${m.count - 1}` : ''}` };
		});
	});

	let picking = $state(false);
	/** adds or removes the pattern for exactly `rel` */
	function toggleExclude(rel: string, on: boolean) {
		const rest = patterns.filter((p) => patternPath(p) !== rel);
		form.exclude = (on ? [...rest, `/${rel}`] : rest).join('\n');
	}

	const draft = $derived<ResticSettings | null>(
		form.enabled
			? {
					schedule: form.schedule.trim(),
					exclude: patterns,
					excludeVolumes: allVolumes.filter((v) => !form.included[v]),
					beforeUpdate: form.beforeUpdate
				}
			: null
	);
	const dirty = $derived(JSON.stringify(draft) !== stored);

	async function save() {
		saving = true;
		problem = null;
		try {
			const res = await saveBackup({ name, settings: draft });
			if (res.error) problem = res.error;
			else {
				// the parent re-mounts this component with the saved settings
				unsaved.drop();
				toast.success(draft ? 'Backup settings saved' : 'Backups disabled');
			}
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
		<StaleDraft draft={unsaved} what="The backup settings" ondiscard={() => (form = fields())} />
		<Switch
			bind:checked={form.enabled}
			label="Back up this project"
			description="Adds a resticprofile profile for this project."
		/>

		{#if form.enabled}
			<div class="grid gap-5 md:grid-cols-2">
				<Field
					label="Schedule"
					hint="resticprofile syntax, e.g. daily, hourly, *-*-* 03:00 or Mon..Fri 22:30. Empty = manual backups only."
					for="restic-schedule"
				>
					<Input id="restic-schedule" bind:value={form.schedule} placeholder="daily" mono />
				</Field>
				<div class="md:pt-7">
					<Switch
						bind:checked={form.beforeUpdate}
						label="Back up before updates"
						description="Also before auto updates. The update is cancelled when the backup fails."
					/>
				</div>
			</div>

			<Field
				label="Exclude"
				hint="restic exclude patterns, one per line. A leading / is the project folder ({dir}), e.g. /logs or *.tmp."
			>
				<CodeEditor
					bind:value={form.exclude}
					language="text"
					minLines={4}
					maxLines={10}
					placeholder="/logs&#10;*.tmp"
					{notes}
				/>
				<div class="flex flex-wrap items-start justify-between gap-2">
					<Button size="xs" onclick={() => (picking = true)}><FolderSearch /> Browse…</Button>
					{#if check?.current?.truncated}
						<p class="text-xs text-zinc-500">
							Large folder: only the first 20,000 files were checked.
						</p>
					{/if}
				</div>
			</Field>
			<ExcludePicker bind:open={picking} {name} {dir} {patterns} ontoggle={toggleExclude} />

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
								bind:checked={form.included[volume]}
								label={volume}
								description={volumes.includes(volume) ? undefined : 'does not exist'}
							/>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		{#if problem}
			<ErrorOutput text={problem} />
		{/if}

		<div class="flex justify-end border-t border-zinc-100 pt-4 dark:border-zinc-800/60">
			<Button variant="primary" onclick={save} loading={saving} disabled={!dirty || saving}
				><Save /> Save</Button
			>
		</div>
	</div>
</Card>
