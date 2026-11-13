<script lang="ts">
	import { Database, HardDrive, Layers, Sparkles, Trash2 } from '@lucide/svelte';
	import {
		getResources,
		pruneUnused,
		removeImage,
		removeVolume
	} from '#lib/remote/projects.remote.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { confirm } from '#lib/components/ui/confirm.svelte.js';
	import { toast } from '#lib/components/ui/toast.svelte.js';
	import { ago, bytes, shortId } from '#lib/format.js';

	let { name }: { name: string } = $props();

	const res = $derived(await getResources(name));
	const unused = $derived(res.images.filter((i) => !i.inUse));
	let busy = $state<string | null>(null);

	async function delImage(id: string, label: string) {
		const ok = await confirm({
			title: 'Delete image?',
			description: label,
			confirmLabel: 'Delete',
			danger: true
		});
		if (!ok) return;
		busy = id;
		try {
			await removeImage({ name, id });
			toast.success('Image deleted');
		} catch (e) {
			toast.error('Could not delete image', e);
		} finally {
			busy = null;
		}
	}

	async function delVolume(volume: string) {
		const ok = await confirm({
			title: `Delete volume ${volume}?`,
			description: 'All data stored in this volume is lost permanently.',
			confirmLabel: 'Delete volume',
			danger: true,
			typeToConfirm: volume
		});
		if (!ok) return;
		busy = volume;
		try {
			await removeVolume({ name, volume });
			toast.success('Volume deleted');
		} catch (e) {
			toast.error('Could not delete volume', e);
		} finally {
			busy = null;
		}
	}

	async function prune() {
		const ok = await confirm({
			title: `Delete ${unused.length} unused image(s)?`,
			description: `Frees ${bytes(unused.reduce((a, i) => a + i.size, 0))}.`,
			confirmLabel: 'Delete',
			danger: true
		});
		if (!ok) return;
		busy = 'prune';
		try {
			const n = await pruneUnused(name);
			toast.success(`${n} image(s) deleted`);
		} catch (e) {
			toast.error('Cleanup failed', e);
		} finally {
			busy = null;
		}
	}
</script>

<div class="grid gap-4">
	<Card
		title="Images"
		description="Images of this project's repositories, including older versions."
		flush
	>
		{#snippet actions()}
			{#if unused.length}
				<Button size="xs" variant="danger-ghost" onclick={prune} loading={busy === 'prune'}
					><Sparkles /> Remove unused ({unused.length})</Button
				>
			{/if}
		{/snippet}
		{#if res.images.length === 0}
			<EmptyState
				icon={Layers}
				title="No images"
				description="Images appear after the first pull or deploy."
			/>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead class="text-left text-xs text-zinc-500">
						<tr class="border-b border-zinc-200 dark:border-zinc-800">
							<th class="px-5 py-2 font-medium">Image</th>
							<th class="px-3 py-2 font-medium">ID</th>
							<th class="px-3 py-2 font-medium">Size</th>
							<th class="px-3 py-2 font-medium">Created</th>
							<th class="px-3 py-2 font-medium">Status</th>
							<th class="px-5 py-2"></th>
						</tr>
					</thead>
					<tbody class="divide-y divide-zinc-100 dark:divide-zinc-800/60">
						{#each res.images as img (img.id)}
							<tr>
								<td class="px-5 py-2.5 font-mono text-xs">
									{#each img.tags as t (t)}<div>{t}</div>{:else}<span class="text-zinc-500"
											>&lt;untagged&gt;</span
										>{/each}
								</td>
								<td class="px-3 py-2.5 font-mono text-xs text-zinc-500">{shortId(img.id)}</td>
								<td class="px-3 py-2.5 whitespace-nowrap tabular-nums">{bytes(img.size)}</td>
								<td class="px-3 py-2.5 whitespace-nowrap text-zinc-500">{ago(img.created)}</td>
								<td class="px-3 py-2.5">
									{#if img.usedByProject}<Badge tone="success">In use</Badge>
									{:else if img.inUse}<Badge tone="info">Used elsewhere</Badge>
									{:else}<Badge tone="warning">Unused</Badge>{/if}
								</td>
								<td class="px-5 py-2.5 text-right">
									<Button
										size="icon-xs"
										variant="danger-ghost"
										title={img.inUse ? 'Image is in use' : 'Delete image'}
										disabled={img.inUse}
										loading={busy === img.id}
										onclick={() => delImage(img.id, img.tags.join(', ') || shortId(img.id))}
										><Trash2 /></Button
									>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Card>

	<Card
		title="Volumes"
		description="Named volumes created by this project. Bind mounts (folders) are not listed."
		flush
	>
		{#if res.volumes.length === 0}
			<EmptyState
				icon={Database}
				title="No volumes"
				description="This project doesn't use named volumes."
			/>
		{:else}
			<div class="divide-y divide-zinc-100 dark:divide-zinc-800/60">
				{#each res.volumes as vol (vol.name)}
					<div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
						<HardDrive class="size-4 text-zinc-400" />
						<div class="min-w-0 flex-1">
							<p class="truncate font-mono text-sm">{vol.name}</p>
							<p class="truncate text-xs text-zinc-500">
								{vol.driver} · created {ago(vol.createdAt)}
								{#if vol.usedBy.length}
									· used by {vol.usedBy.join(', ')}{/if}
							</p>
						</div>
						{#if vol.external}<Badge>external</Badge>{/if}
						{#if vol.inUse}<Badge tone="success">In use</Badge>{:else}<Badge tone="warning"
								>Unused</Badge
							>{/if}
						<Button
							size="icon-xs"
							variant="danger-ghost"
							title={vol.inUse
								? 'Volume is in use (stop/remove the containers first)'
								: 'Delete volume'}
							disabled={vol.inUse}
							loading={busy === vol.name}
							onclick={() => delVolume(vol.name)}><Trash2 /></Button
						>
					</div>
				{/each}
			</div>
		{/if}
	</Card>
</div>
