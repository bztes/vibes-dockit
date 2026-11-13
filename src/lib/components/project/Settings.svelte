<script lang="ts">
	import { FolderOpen, Save, Trash2 } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { deleteProject, saveMeta } from '#lib/remote/projects.remote.js';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Input from '#lib/components/ui/Input.svelte';
	import Switch from '#lib/components/ui/Switch.svelte';
	import { confirm } from '#lib/components/ui/confirm.svelte.js';
	import { toast } from '#lib/components/ui/toast.svelte.js';
	import type { ProjectSummary } from '#lib/server/status.js';

	let { summary }: { summary: ProjectSummary } = $props();

	// svelte-ignore state_referenced_locally
	let description = $state(summary.description ?? '');
	// svelte-ignore state_referenced_locally
	let url = $state(summary.url ?? '');
	// svelte-ignore state_referenced_locally
	let autoUpdate = $state(summary.autoUpdate);
	let saving = $state(false);
	let deleting = $state(false);

	async function save() {
		saving = true;
		try {
			await saveMeta({ name: summary.name, description, url, autoUpdate });
			toast.success('Saved to the x-dockit block of the compose file');
		} catch (e) {
			toast.error('Could not save', e);
		} finally {
			saving = false;
		}
	}

	async function remove() {
		const ok = await confirm({
			title: `Delete ${summary.name}?`,
			description:
				'Runs docker compose down and moves the project folder to .trash inside the projects folder.',
			confirmLabel: 'Delete project',
			danger: true,
			typeToConfirm: summary.name,
			checkbox: 'Also delete named volumes (data is lost)'
		});
		if (!ok) return;
		deleting = true;
		try {
			await deleteProject({ name: summary.name, removeVolumes: ok.checked });
			toast.success(`${summary.name} deleted`);
			await goto('/');
		} catch (e) {
			toast.error('Could not delete project', e);
		} finally {
			deleting = false;
		}
	}
</script>

<div class="grid gap-4">
	<Card
		title="General"
		description="Stored in the compose file, so nothing gets lost when the database is reset."
	>
		<div class="grid gap-5">
			<Field label="Description">
				<Input bind:value={description} placeholder="What is this project for?" maxlength={200} />
			</Field>
			<Field
				label="URL"
				hint="Shown as a link on the project. Leave empty to use the first domain from the Domains tab."
			>
				<Input bind:value={url} placeholder="https://app.example.com" type="url" />
			</Field>
			<Switch
				bind:checked={autoUpdate}
				label="Automatic updates"
				description="Pull and recreate the containers as soon as the scheduled check finds a new image."
			/>
			<div
				class="flex items-center justify-between gap-4 border-t border-zinc-100 pt-4 dark:border-zinc-800/60"
			>
				<p class="flex min-w-0 items-center gap-1.5 text-xs text-zinc-500">
					<FolderOpen class="size-3.5 shrink-0" /><code class="truncate font-mono"
						>{summary.dir}</code
					>
				</p>
				<Button variant="primary" onclick={save} loading={saving}><Save /> Save</Button>
			</div>
		</div>
	</Card>

	{#if !summary.isSelf}
		<Card title="Danger zone" class="border-red-500/30 dark:border-red-500/20">
			<div class="flex flex-wrap items-center justify-between gap-4">
				<div>
					<p class="text-sm font-medium">Delete this project</p>
					<p class="text-sm text-zinc-500">
						Containers are removed, the folder is moved to <code class="font-mono text-xs"
							>.trash</code
						>.
					</p>
				</div>
				<Button variant="danger" onclick={remove} loading={deleting}
					><Trash2 /> Delete project</Button
				>
			</div>
		</Card>
	{/if}
</div>
