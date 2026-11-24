<script lang="ts">
	import { ArchiveArrowUp, DatabaseBackup, RefreshCw, Trash2 } from '@lucide/svelte';
	import { backupNow, deleteSnapshot, getSnapshots, restoreSnapshot } from './restic.remote';
	import { watchJobs } from '#lib/remote/projects.remote.js';
	import Button from '#lib/components/ui/Button.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Switch from '#lib/components/ui/Switch.svelte';
	import { openJob } from '#lib/components/app/jobs.svelte.js';
	import { toast } from '#lib/components/ui/toast.svelte.js';
	import { confirm } from '#lib/components/ui/confirm.svelte.js';
	import { ago, bytes } from '#lib/format.js';
	import { snapshotVolumes, type Snapshot } from './restic';

	let {
		name,
		dir,
		enabled,
		canRestore,
		hooks
	}: { name: string; dir: string; enabled: boolean; canRestore: boolean; hooks: boolean } =
		$props();

	const query = $derived(getSnapshots(name));
	const data = $derived(await query);

	// new snapshots after a backup (manual, before an update) or a restore, deleted ones
	const jobs = watchJobs();
	const finished = $derived(
		(jobs.current ?? [])
			.filter(
				(j) =>
					j.project === name &&
					j.finishedAt &&
					/^(Backup|Restore|Update|Delete snapshot)\b/.test(j.action)
			)
			.map((j) => j.id)
			.join()
	);
	let seen: string | undefined;
	$effect(() => {
		if (seen !== undefined && finished !== seen) void query.refresh();
		seen = finished;
	});

	let starting = $state(false);
	let refreshing = $state(false);

	async function backup() {
		starting = true;
		try {
			openJob((await backupNow(name)).jobId);
		} catch (e) {
			toast.error('Could not start the backup', e);
		} finally {
			starting = false;
		}
	}

	async function refresh() {
		refreshing = true;
		try {
			await query.refresh();
		} finally {
			refreshing = false;
		}
	}

	// restore dialog
	let target = $state<Snapshot | null>(null);
	let open = $state(false);
	let files = $state(true);
	let volumes = $state<Record<string, boolean>>({});
	let remove = $state(true);
	let restoring = $state(false);

	const targetVolumes = $derived(target ? snapshotVolumes(target) : []);
	const hasFiles = $derived(!!target?.paths.includes(dir));
	const selectedVolumes = $derived(targetVolumes.filter((v) => volumes[v]));
	// `files` can only be on when the snapshot has the project files
	const nothing = $derived(!files && selectedVolumes.length === 0);

	function openRestore(snapshot: Snapshot) {
		target = snapshot;
		files = snapshot.paths.includes(dir);
		volumes = Object.fromEntries(snapshotVolumes(snapshot).map((v) => [v, true]));
		remove = true;
		open = true;
	}

	async function restore() {
		if (!target) return;
		restoring = true;
		try {
			const res = await restoreSnapshot({
				name,
				snapshot: target.id,
				files,
				volumes: selectedVolumes,
				delete: remove
			});
			open = false;
			openJob(res.jobId);
		} catch (e) {
			toast.error('Could not start the restore', e);
		} finally {
			restoring = false;
		}
	}

	let deleting = $state<string | null>(null);

	async function forget(snapshot: Snapshot) {
		const ok = await confirm({
			title: `Delete snapshot ${snapshot.shortId}?`,
			description: `The snapshot from ${new Date(snapshot.time).toLocaleString()} is forgotten. Without pruning, its data stays in the repository until the next scheduled prune.`,
			confirmLabel: 'Delete',
			danger: true,
			checkbox: 'Prune now to free the space (can take a while)'
		});
		if (!ok) return;
		deleting = snapshot.id;
		try {
			openJob((await deleteSnapshot({ name, snapshot: snapshot.id, prune: ok.checked })).jobId);
		} catch (e) {
			toast.error('Could not delete the snapshot', e);
		} finally {
			deleting = null;
		}
	}

	const contents = (s: Snapshot) => {
		const vols = snapshotVolumes(s).length;
		const parts = s.paths.includes(dir) ? ['files'] : [];
		if (vols) parts.push(`${vols} volume${vols === 1 ? '' : 's'}`);
		return parts.join(' + ') || s.paths.join(', ');
	};
</script>

<Card title="Snapshots" description="Backups of this project in the restic repository.">
	{#snippet actions()}
		<Button
			size="icon-sm"
			variant="ghost"
			title="Refresh"
			aria-label="Refresh"
			onclick={refresh}
			loading={refreshing}><RefreshCw /></Button
		>
		<Button
			size="sm"
			variant="primary"
			onclick={backup}
			loading={starting}
			disabled={!enabled || starting}
			title={enabled ? undefined : 'Enable backups of this project first'}
			><DatabaseBackup /> Back up now</Button
		>
	{/snippet}

	{#if data.error}
		<pre
			class="overflow-x-auto font-mono text-xs whitespace-pre-wrap text-red-600 dark:text-red-400">{data.error}</pre>
	{:else if data.snapshots.length === 0}
		<EmptyState
			icon={DatabaseBackup}
			title="No snapshots yet"
			description={enabled
				? 'The first backup runs on schedule, or start one now.'
				: 'Enable backups of this project to create snapshots.'}
		/>
	{:else}
		<div class="-mx-5 -my-4 overflow-x-auto">
			<table class="w-full text-sm">
				<thead class="text-left text-xs text-zinc-500">
					<tr class="border-b border-zinc-100 dark:border-zinc-800/60">
						<th class="px-5 py-2.5 font-medium">Time</th>
						<th class="px-3 py-2.5 font-medium">Snapshot</th>
						<th class="px-3 py-2.5 font-medium">Contents</th>
						<th class="px-3 py-2.5 text-right font-medium">Size</th>
						<th class="px-3 py-2.5 text-right font-medium">Added</th>
						<th class="px-5 py-2.5"></th>
					</tr>
				</thead>
				<tbody>
					{#each data.snapshots as s (s.id)}
						<tr class="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
							<td class="px-5 py-2.5 whitespace-nowrap" title={s.time}
								>{new Date(s.time).toLocaleString()}
								<span class="text-xs text-zinc-500">· {ago(s.time)}</span></td
							>
							<td class="px-3 py-2.5 font-mono text-xs">{s.shortId}</td>
							<td class="px-3 py-2.5 text-zinc-600 dark:text-zinc-400" title={s.paths.join('\n')}
								>{contents(s)}</td
							>
							<td class="px-3 py-2.5 text-right whitespace-nowrap tabular-nums"
								>{s.size === null ? '–' : bytes(s.size)}</td
							>
							<td class="px-3 py-2.5 text-right whitespace-nowrap tabular-nums"
								>{s.added === null ? '–' : bytes(s.added)}</td
							>
							<td class="px-5 py-2.5 text-right whitespace-nowrap">
								{#if canRestore}
									<Button size="xs" variant="ghost" onclick={() => openRestore(s)}
										><ArchiveArrowUp /> Restore</Button
									>
								{/if}
								<Button
									size="icon-xs"
									variant="ghost"
									title="Delete snapshot"
									aria-label="Delete snapshot {s.shortId}"
									onclick={() => forget(s)}
									loading={deleting === s.id}><Trash2 /></Button
								>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</Card>

<Dialog
	bind:open
	title="Restore snapshot {target?.shortId ?? ''}"
	description={target ? `From ${new Date(target.time).toLocaleString()}` : undefined}
>
	{#if target}
		<div class="grid gap-4">
			<div class="grid gap-3">
				{#if hasFiles}
					<Switch bind:checked={files} label="Project files" description={dir} />
				{/if}
				{#each targetVolumes as volume (volume)}
					<Switch bind:checked={volumes[volume]} label={volume} description="Volume" />
				{/each}
			</div>
			<Switch
				bind:checked={remove}
				label="Remove files that are not in the snapshot"
				description="Makes the restored folders exactly match the snapshot. Files excluded from the backup are kept."
			/>
			<Alert size="sm"
				>The project is taken down and the selected data is overwritten with the snapshot. A running
				project is started again afterwards.{#if hooks && files}
					The post-restore hooks run first, with only the services with hooks started.{/if}
			</Alert>
		</div>
	{/if}
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="danger" onclick={restore} loading={restoring} disabled={nothing || restoring}
			><ArchiveArrowUp /> Restore</Button
		>
	{/snippet}
</Dialog>
