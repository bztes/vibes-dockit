<script lang="ts">
	import {
		ChevronRight,
		Download,
		File as FileIcon,
		FilePlus,
		Folder,
		FolderOpen,
		FolderPlus,
		House,
		Link2,
		LoaderCircle,
		Pencil,
		RefreshCw,
		Settings2,
		Trash2,
		Upload
	} from '@lucide/svelte';
	import {
		createFolder,
		deleteProjectFile,
		listProjectFiles,
		moveProjectFile,
		writeProjectFile
	} from '#lib/remote/projects.remote.js';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Input from '#lib/components/ui/Input.svelte';
	import FileEditor from './FileEditor.svelte';
	import { confirm } from '#lib/components/ui/confirm.svelte.js';
	import { toast } from '#lib/components/ui/toast.svelte.js';
	import { ago, bytes } from '#lib/format.js';

	let { name, onconfig }: { name: string; onconfig: () => void } = $props();

	let dir = $state('');
	let editing = $state<string | null>(null);

	const query = $derived(listProjectFiles({ name, path: dir }));
	const entries = $derived(await query);
	const crumbs = $derived(
		dir ? dir.split('/').map((part, i, all) => ({ part, path: all.slice(0, i + 1).join('/') })) : []
	);

	const join = (...parts: string[]) => parts.filter(Boolean).join('/');
	const downloadUrl = (path: string) => `/projects/${name}/files?path=${encodeURIComponent(path)}`;

	// ---- create / rename dialog

	let dialog = $state<{
		mode: 'file' | 'folder' | 'rename';
		value: string;
		target?: string;
	} | null>(null);
	let dialogOpen = $state(false);
	let busy = $state<string | null>(null);

	function openDialog(mode: 'file' | 'folder' | 'rename', target?: string) {
		dialog = { mode, value: target?.split('/').pop() ?? '', target };
		dialogOpen = true;
	}

	const dialogTitle = $derived(
		dialog?.mode === 'file' ? 'New file' : dialog?.mode === 'folder' ? 'New folder' : 'Rename'
	);

	async function submitDialog(e: SubmitEvent) {
		e.preventDefault();
		if (!dialog) return;
		const value = dialog.value.trim();
		if (!value) return;
		busy = 'dialog';
		try {
			if (dialog.mode === 'file') {
				const path = join(dir, value);
				await writeProjectFile({ name, path, content: '', create: true });
				dialogOpen = false;
				editing = path;
			} else if (dialog.mode === 'folder') {
				await createFolder({ name, path: join(dir, value) });
				dialogOpen = false;
				toast.success('Folder created');
			} else if (dialog.target) {
				const parent = dialog.target.split('/').slice(0, -1).join('/');
				await moveProjectFile({ name, from: dialog.target, to: join(parent, value) });
				dialogOpen = false;
				toast.success('Renamed');
			}
		} catch (err) {
			toast.error(`${dialogTitle} failed`, err);
		} finally {
			busy = null;
		}
	}

	async function remove(path: string, isDir: boolean) {
		const ok = await confirm({
			title: `Delete ${path.split('/').pop()}?`,
			description: isDir
				? 'The folder and everything inside it is deleted permanently.'
				: 'The file is deleted permanently.',
			confirmLabel: 'Delete',
			danger: true
		});
		if (!ok) return;
		busy = path;
		try {
			await deleteProjectFile({ name, path });
			toast.success('Deleted');
		} catch (e) {
			toast.error('Could not delete', e);
		} finally {
			busy = null;
		}
	}

	// ---- upload

	let fileInput = $state<HTMLInputElement>();
	let uploading = $state<{ current: string; done: number; total: number } | null>(null);
	let dragging = $state(false);

	async function put(path: string, file: Blob, overwrite: boolean) {
		const query = `path=${encodeURIComponent(path)}${overwrite ? '&overwrite=1' : ''}`;
		return fetch(`/projects/${name}/files?${query}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/octet-stream' },
			body: file
		});
	}

	async function upload(files: { path: string; file: File }[]) {
		if (!files.length) return;
		let ok = 0;
		uploading = { current: '', done: 0, total: files.length };
		try {
			for (const { path, file } of files) {
				uploading.current = path;
				let res = await put(path, file, false);
				if (res.status === 409) {
					const yes = await confirm({
						title: `Replace ${path}?`,
						description: 'A file with this name already exists.',
						confirmLabel: 'Replace',
						danger: true
					});
					if (yes) res = await put(path, file, true);
				}
				if (res.ok) ok++;
				else if (res.status !== 409) {
					const body = await res.json().catch(() => null);
					toast.error(`Upload of ${path} failed`, body?.message ?? res.statusText);
				}
				uploading.done++;
			}
		} catch (e) {
			toast.error('Upload failed', e);
		} finally {
			uploading = null;
			void query.refresh();
		}
		if (ok) toast.success(`${ok} file${ok === 1 ? '' : 's'} uploaded`);
	}

	function pick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const files = [...(input.files ?? [])].map((file) => ({ path: join(dir, file.name), file }));
		input.value = '';
		void upload(files);
	}

	/** reads dropped files, including whole folders */
	async function collect(
		entry: FileSystemEntry,
		base: string
	): Promise<{ path: string; file: File }[]> {
		const path = join(base, entry.name);
		if (entry.isFile) {
			const file = await new Promise<File>((res, rej) =>
				(entry as FileSystemFileEntry).file(res, rej)
			);
			return [{ path, file }];
		}
		const reader = (entry as FileSystemDirectoryEntry).createReader();
		const children: FileSystemEntry[] = [];
		// readEntries returns at most 100 entries per call
		while (true) {
			const batch = await new Promise<FileSystemEntry[]>((res, rej) =>
				reader.readEntries(res, rej)
			);
			if (!batch.length) break;
			children.push(...batch);
		}
		return (await Promise.all(children.map((c) => collect(c, path)))).flat();
	}

	async function drop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		const items = [...(e.dataTransfer?.items ?? [])]
			.map((i) => i.webkitGetAsEntry())
			.filter((x): x is FileSystemEntry => !!x);
		try {
			const files = (await Promise.all(items.map((i) => collect(i, dir)))).flat();
			await upload(files);
		} catch (err) {
			toast.error('Could not read the dropped files', err);
		}
	}

	function open(entry: (typeof entries)[number]) {
		if (entry.type === 'dir') dir = entry.path;
		else if (entry.managed) onconfig();
		else editing = entry.path;
	}
</script>

{#if editing}
	<svelte:boundary>
		<FileEditor {name} path={editing} onclose={() => (editing = null)} />
		{#snippet pending()}
			<div class="grid place-items-center py-20 text-zinc-400">
				<LoaderCircle class="size-5 animate-spin" />
			</div>
		{/snippet}
		{#snippet failed(error)}
			<Card>
				<EmptyState
					icon={FileIcon}
					title="Could not open {editing}"
					description={(error as { body?: { message?: string } })?.body?.message ??
						(error as Error)?.message}
				>
					<Button onclick={() => (editing = null)}>Back to files</Button>
				</EmptyState>
			</Card>
		{/snippet}
	</svelte:boundary>
{:else}
	<Card flush>
		{#snippet actions()}
			<Button
				size="xs"
				variant="ghost"
				onclick={() => query.refresh()}
				title="Refresh"
				aria-label="Refresh"><RefreshCw /></Button
			>
			<Button size="xs" onclick={() => openDialog('folder')}><FolderPlus /> Folder</Button>
			<Button size="xs" onclick={() => openDialog('file')}><FilePlus /> File</Button>
			<Button size="xs" variant="primary" onclick={() => fileInput?.click()} loading={!!uploading}
				><Upload /> Upload</Button
			>
			<input bind:this={fileInput} type="file" multiple hidden onchange={pick} />
		{/snippet}

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class={['relative', dragging && 'bg-primary/5 ring-2 ring-primary/50 ring-inset']}
			ondragover={(e) => {
				if (e.dataTransfer?.types.includes('Files')) {
					e.preventDefault();
					dragging = true;
				}
			}}
			ondragleave={(e) => {
				if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) dragging = false;
			}}
			ondrop={drop}
		>
			<nav
				class="flex flex-wrap items-center gap-1 border-b border-zinc-200 px-5 py-2.5 font-mono text-xs dark:border-zinc-800"
				aria-label="Current folder"
			>
				<button
					class="inline-flex items-center gap-1 rounded px-1 py-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
					onclick={() => (dir = '')}><House class="size-3.5" />{name}</button
				>
				{#each crumbs as c (c.path)}
					<ChevronRight class="size-3.5 text-zinc-400" />
					<button
						class="rounded px-1 py-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
						onclick={() => (dir = c.path)}>{c.part}</button
					>
				{/each}
				{#if uploading}
					<span class="ml-auto inline-flex items-center gap-1.5 font-sans text-zinc-500">
						<LoaderCircle class="size-3.5 animate-spin" />
						Uploading {uploading.done + 1}/{uploading.total} · {uploading.current}
					</span>
				{/if}
			</nav>

			{#if entries.length === 0}
				<EmptyState
					icon={FolderOpen}
					title="This folder is empty"
					description="Create a file or drop files and folders here to upload them."
				/>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead class="text-left text-xs text-zinc-500">
							<tr class="border-b border-zinc-200 dark:border-zinc-800">
								<th class="px-5 py-2 font-medium">Name</th>
								<th class="px-3 py-2 text-right font-medium">Size</th>
								<th class="hidden px-3 py-2 font-medium sm:table-cell">Modified</th>
								<th class="px-5 py-2"></th>
							</tr>
						</thead>
						<tbody class="divide-y divide-zinc-100 dark:divide-zinc-800/60">
							{#each entries as entry (entry.path)}
								{@const Icon =
									entry.type === 'dir' ? Folder : entry.type === 'symlink' ? Link2 : FileIcon}
								<tr class="group hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
									<td class="px-5 py-2">
										<button
											class="flex max-w-full items-center gap-2 text-left hover:underline disabled:no-underline"
											onclick={() => open(entry)}
											disabled={entry.type === 'other'}
											title={entry.managed ? 'Edit in the Configuration tab' : undefined}
										>
											<Icon
												class={[
													'size-4 shrink-0',
													entry.type === 'dir' ? 'text-sky-500' : 'text-zinc-400'
												]}
											/>
											<span class="truncate font-mono text-xs">{entry.name}</span>
											{#if entry.managed}<Settings2 class="size-3.5 shrink-0 text-zinc-400" />{/if}
										</button>
									</td>
									<td class="px-3 py-2 text-right whitespace-nowrap text-zinc-500 tabular-nums">
										{entry.type === 'dir' ? '' : bytes(entry.size)}
									</td>
									<td class="hidden px-3 py-2 whitespace-nowrap text-zinc-500 sm:table-cell">
										{entry.modified ? ago(entry.modified) : ''}
									</td>
									<td class="px-5 py-2">
										<div class="flex justify-end gap-1">
											{#if entry.type !== 'dir'}
												<Button
													size="icon-xs"
													variant="ghost"
													href={downloadUrl(entry.path)}
													download
													title="Download"
													aria-label="Download {entry.name}"><Download /></Button
												>
											{/if}
											{#if !entry.managed}
												<Button
													size="icon-xs"
													variant="ghost"
													onclick={() => openDialog('rename', entry.path)}
													title="Rename"
													aria-label="Rename {entry.name}"><Pencil /></Button
												>
												<Button
													size="icon-xs"
													variant="danger-ghost"
													loading={busy === entry.path}
													onclick={() => remove(entry.path, entry.type === 'dir')}
													title="Delete"
													aria-label="Delete {entry.name}"><Trash2 /></Button
												>
											{/if}
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	</Card>
{/if}

<Dialog bind:open={dialogOpen} title={dialogTitle} size="sm">
	{#if dialog}
		<form id="file-dialog" onsubmit={submitDialog}>
			<Field
				label="Name"
				hint={dialog.mode === 'rename' ? undefined : 'Use / to create it in a sub folder.'}
			>
				<!-- svelte-ignore a11y_autofocus -->
				<Input bind:value={dialog.value} mono autofocus autocomplete="off" required />
			</Field>
		</form>
	{/if}
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (dialogOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="file-dialog" loading={busy === 'dialog'}>
			{dialog?.mode === 'rename' ? 'Rename' : 'Create'}
		</Button>
	{/snippet}
</Dialog>
