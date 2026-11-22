<script lang="ts">
	import { ArrowLeft, Download, FileExclamationPoint, RotateCcw, Save } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import { readProjectFile, writeProjectFile } from '#lib/remote/projects.remote.js';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import CodeEditor from '#lib/components/ui/CodeEditor.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import StaleDraft from '#lib/components/app/StaleDraft.svelte';
	import { draftKey, useDraft, type Draft } from '#lib/components/app/drafts.svelte.js';
	import { confirm } from '#lib/components/ui/confirm.svelte.js';
	import { toast } from '#lib/components/ui/toast.svelte.js';
	import { bytes } from '#lib/format.js';

	let { name, path, onclose }: { name: string; path: string; onclose: () => void } = $props();

	const file = $derived(await readProjectFile({ name, path }));

	// the files page re-mounts the editor for another file
	// svelte-ignore state_referenced_locally
	const unsaved: Draft<string> = useDraft(draftKey(name, 'files', path), {
		base: () => original,
		dirty: () => dirty,
		value: () => value
	});

	// svelte-ignore state_referenced_locally
	let value = $state(unsaved.saved ?? file.content ?? '');
	// svelte-ignore state_referenced_locally
	let original = $state(file.content ?? '');
	// svelte-ignore state_referenced_locally
	let modified = $state(file.modified);
	let saving = $state(false);

	$effect.pre(() => {
		const f = file;
		untrack(() => {
			if (f.content === null) return;
			// keep local edits when the file is refreshed
			if (value === original) value = f.content;
			original = f.content;
			modified = f.modified;
		});
	});

	const dirty = $derived(file.content !== null && value !== original);
	const filename = $derived(path.split('/').pop() ?? path);
	const language = $derived(
		/\.ya?ml$/i.test(filename) ? 'yaml' : /^\.env|\.env$/i.test(filename) ? 'env' : 'text'
	);
	const download = $derived(`/projects/${name}/raw?path=${encodeURIComponent(path)}`);

	async function save() {
		if (!dirty || saving) return;
		saving = true;
		try {
			modified = await writeProjectFile({ name, path, content: value, expectedModified: modified });
			original = value;
			toast.success('Saved');
		} catch (e) {
			toast.error('Could not save', e);
		} finally {
			saving = false;
		}
	}

	async function close() {
		if (dirty) {
			const ok = await confirm({
				title: 'Discard changes?',
				description: `${path} has unsaved changes.`,
				confirmLabel: 'Discard',
				danger: true
			});
			if (!ok) return;
		}
		onclose();
	}
</script>

<div class="grid gap-4">
	<div
		class="sticky top-14 z-10 -mx-1 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white/90 px-3 py-2 backdrop-blur lg:top-2 dark:border-zinc-800 dark:bg-zinc-900/90"
	>
		<div class="flex min-w-0 items-center gap-2">
			<Button size="icon-xs" variant="ghost" onclick={close} title="Back" aria-label="Back"
				><ArrowLeft /></Button
			>
			<span class="truncate font-mono text-sm">{path}</span>
			<span class="text-sm whitespace-nowrap text-zinc-500">
				{#if dirty}<span class="font-medium text-amber-600 dark:text-amber-400">· Unsaved</span>
				{:else}· {bytes(file.size)}{/if}
			</span>
		</div>
		<div class="flex flex-wrap gap-2">
			<Button size="sm" variant="ghost" href={download} download><Download /> Download</Button>
			{#if dirty}
				<Button size="sm" variant="ghost" onclick={() => (value = original)}
					><RotateCcw /> Discard</Button
				>
			{/if}
			{#if file.content !== null}
				<Button size="sm" variant="primary" onclick={save} loading={saving} disabled={!dirty}
					><Save /> Save</Button
				>
			{/if}
		</div>
	</div>

	<StaleDraft draft={unsaved} what="The file" ondiscard={() => (value = original)} />

	{#if file.content === null}
		<Card>
			<EmptyState
				icon={FileExclamationPoint}
				title={file.reason === 'binary' ? 'Binary file' : 'File is too large'}
				description={file.reason === 'binary'
					? 'This file cannot be edited in the browser. Download it instead.'
					: `Only files up to 2 MB can be edited in the browser (${bytes(file.size)}).`}
			>
				<Button href={download} download><Download /> Download</Button>
			</EmptyState>
		</Card>
	{:else}
		<CodeEditor bind:value {language} maxLines={Infinity} onsave={save} />
	{/if}
</div>
