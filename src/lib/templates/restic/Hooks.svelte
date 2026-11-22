<script lang="ts">
	import { Pencil, Plus, Save, Trash } from '@lucide/svelte';
	import { addHooks, removeHooks, saveHooks } from './restic.remote';
	import Badge from '#lib/components/ui/Badge.svelte';
	import ChoiceCard from '#lib/components/ui/ChoiceCard.svelte';
	import ErrorOutput from '#lib/components/ui/ErrorOutput.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Select from '#lib/components/ui/Select.svelte';
	import Textarea from '#lib/components/ui/Textarea.svelte';
	import { confirm } from '#lib/components/ui/confirm.svelte.js';
	import { toast } from '#lib/components/ui/toast.svelte.js';
	import { PHASES, type HookSet, type Hooks, type Phase } from './hooks';
	import { PRESET_INFO, PRESETS, type Preset } from './presets';

	let {
		name,
		sets,
		candidates
	}: {
		name: string;
		sets: Hooks;
		candidates: string[];
	} = $props();

	const entries = $derived(Object.entries(sets));

	let busy = $state<string | null>(null);
	let problem = $state<string | null>(null);

	let adding = $state(false);
	let addBusy = $state(false);
	let addProblem = $state<string | null>(null);
	let service = $state('');
	let preset = $state<Preset>('custom');
	const templates = PRESETS.filter((p) => p !== 'custom');

	let editing = $state<string | null>(null);
	let editOpen = $state(false);
	let editBusy = $state(false);
	let editProblem = $state<string | null>(null);
	let scripts = $state<Record<Phase, string>>(emptyScripts());

	function emptyScripts() {
		return Object.fromEntries(PHASES.map((p) => [p, ''])) as Record<Phase, string>;
	}

	function openAdd() {
		service = candidates[0] ?? '';
		preset = 'custom';
		addProblem = null;
		adding = true;
	}

	async function add() {
		if (!service) return;
		addBusy = true;
		addProblem = null;
		try {
			const res = await addHooks({ name, service, preset });
			if (res.error) addProblem = res.error;
			else {
				adding = false;
				toast.success(`Hooks for ${service} added`);
			}
		} catch (e) {
			toast.error('Could not add the hooks', e);
		} finally {
			addBusy = false;
		}
	}

	function openEdit(set: string, hooks: HookSet) {
		editing = set;
		scripts = { ...emptyScripts(), ...hooks };
		editProblem = null;
		editOpen = true;
	}

	async function save() {
		if (!editing) return;
		editBusy = true;
		editProblem = null;
		try {
			const res = await saveHooks({ name, set: editing, scripts });
			if (res.error) editProblem = res.error;
			else {
				editOpen = false;
				toast.success(`Hooks of ${editing} saved`);
			}
		} catch (e) {
			toast.error('Could not save the hooks', e);
		} finally {
			editBusy = false;
		}
	}

	async function remove(set: string) {
		const ok = await confirm({
			title: `Remove the hooks of ${set}?`,
			description: 'Its scripts are removed from dockit.json. Existing dumps in .backup are kept.',
			confirmLabel: 'Remove',
			danger: true
		});
		if (!ok) return;
		busy = set;
		problem = null;
		try {
			const res = await removeHooks({ name, set });
			if (res.error) problem = res.error;
			else toast.success(`Hooks of ${set} removed`);
		} catch (e) {
			toast.error('Could not remove the hooks', e);
		} finally {
			busy = null;
		}
	}

	const PHASE_HELP: Record<Phase, string> = {
		'pre-backup': 'Before every backup. A failure cancels the backup.',
		'post-backup': 'After a successful backup.',
		'backup-failed': 'After a failed backup.',
		'pre-restore': 'Before a restore of the project files, while the project still runs.',
		'post-restore':
			'After a restore of the project files, with only the services with hooks started.',
		'restore-failed': 'After a failed restore.'
	};
</script>

{#snippet option(id: Preset)}
	<ChoiceCard
		type="radio"
		name="hooks-preset"
		label={PRESET_INFO[id].label}
		description={PRESET_INFO[id].description}
		value={id}
		checked={preset === id}
		onchange={() => (preset = id)}
	/>
{/snippet}

<Card
	title="Backup hooks"
	description="Shell scripts that run before backups and after restores, e.g. a database dump. They run in the restic container and reach the services with docker exec."
>
	<div class="grid gap-4">
		{#if entries.length}
			<ul class="-mx-5 -mt-4 divide-y divide-zinc-100 dark:divide-zinc-800/60">
				{#each entries as [set, hooks] (set)}
					{@const phases = PHASES.filter((p) => hooks[p])}
					<li class="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
						<p class="min-w-0 flex-1 font-mono text-sm font-medium">{set}</p>
						<div class="flex flex-wrap gap-1.5">
							{#each phases as phase (phase)}
								<Badge>{phase}</Badge>
							{:else}
								<Badge tone="warning">no hooks</Badge>
							{/each}
						</div>
						<div class="flex gap-1">
							<Button
								size="icon-sm"
								variant="ghost"
								title="Edit"
								aria-label="Edit the hooks of {set}"
								onclick={() => openEdit(set, hooks)}
								disabled={busy !== null}><Pencil /></Button
							>
							<Button
								size="icon-sm"
								variant="ghost"
								title="Remove"
								aria-label="Remove the hooks of {set}"
								onclick={() => remove(set)}
								loading={busy === set}
								disabled={busy !== null}><Trash /></Button
							>
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		{#if candidates.length}
			<div>
				<Button size="sm" onclick={openAdd} disabled={busy !== null}><Plus /> Add hooks</Button>
			</div>
		{:else if !entries.length}
			<p class="text-sm text-zinc-500">No service to add hooks for.</p>
		{/if}

		{#if problem}<ErrorOutput text={problem} />{/if}

		<p class="text-xs text-zinc-500">
			Stored in <code class="font-mono">dockit.json</code>. The scripts run with
			<code class="font-mono">sh -e</code> in the project folder. Dumps go to
			<code class="font-mono">.backup/</code> and are backed up with the project files; post-restore hooks
			run when the project files are restored.
		</p>
	</div>
</Card>

<Dialog bind:open={adding} size="lg" title="Add backup hooks" description="Hooks for one service.">
	<div class="grid gap-4">
		<Field label="Service" for="hooks-service">
			<Select id="hooks-service" bind:value={service}>
				{#each candidates as c (c)}
					<option value={c}>{c}</option>
				{/each}
			</Select>
		</Field>

		<Field label="Hooks">
			<div class="grid gap-2">
				{@render option('custom')}
				<p class="mt-2 text-xs font-medium text-zinc-500">Database templates</p>
				<div class="grid gap-2 sm:grid-cols-2">
					{#each templates as id (id)}{@render option(id)}{/each}
				</div>
			</div>
		</Field>

		{#if preset !== 'custom'}
			<p class="text-xs text-zinc-500">
				The commands run with the tools of the service's container: pick the template of its
				database. You can edit them afterwards.
			</p>
		{/if}

		{#if addProblem}<ErrorOutput text={addProblem} />{/if}
	</div>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (adding = false)}>Cancel</Button>
		<Button onclick={add} loading={addBusy} disabled={!service || addBusy}><Plus /> Add</Button>
	{/snippet}
</Dialog>

<Dialog
	bind:open={editOpen}
	size="lg"
	title="Hooks of {editing}"
	description="Shell scripts, run with sh -e in the project folder of the restic container. Empty = no hook."
>
	<div class="grid gap-4">
		{#each PHASES as phase (phase)}
			<Field label={phase} for="hook-{phase}" hint={PHASE_HELP[phase]}>
				<Textarea
					id="hook-{phase}"
					mono
					rows={phase === 'pre-backup' || phase === 'post-restore' ? 5 : 2}
					spellcheck={false}
					bind:value={scripts[phase]}
				/>
			</Field>
		{/each}
		{#if editProblem}<ErrorOutput text={editProblem} />{/if}
	</div>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (editOpen = false)}>Cancel</Button>
		<Button onclick={save} loading={editBusy} disabled={editBusy}><Save /> Save</Button>
	{/snippet}
</Dialog>
