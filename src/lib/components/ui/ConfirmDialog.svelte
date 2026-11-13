<script lang="ts">
	import Button from './Button.svelte';
	import Dialog from './Dialog.svelte';
	import Input from './Input.svelte';
	import { confirmState } from './confirm.svelte';

	let typed = $state('');
	let checked = $state(false);
	let open = $state(false);
	let result: false | { checked: boolean } = false;

	$effect(() => {
		if (confirmState.current?.open) {
			typed = '';
			checked = false;
			result = false;
			open = true;
		}
	});

	function close() {
		const current = confirmState.current;
		if (!current) return;
		current.resolve(result);
		confirmState.current = null;
	}

	const c = $derived(confirmState.current);
	const blocked = $derived(!!c?.typeToConfirm && typed !== c.typeToConfirm);
</script>

<Dialog bind:open title={c?.title} description={c?.description} size="sm" onclose={close}>
	{#if c?.typeToConfirm}
		<p class="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
			Type <code class="rounded bg-zinc-100 px-1 font-mono text-xs dark:bg-zinc-800"
				>{c.typeToConfirm}</code
			> to confirm.
		</p>
		<Input bind:value={typed} autocomplete="off" />
	{/if}
	{#if c?.checkbox}
		<label class="mt-3 flex items-center gap-2 text-sm">
			<input type="checkbox" bind:checked class="size-4 accent-danger" />
			{c.checkbox}
		</label>
	{/if}
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
		<Button
			variant={c?.danger ? 'danger' : 'primary'}
			disabled={blocked}
			onclick={() => {
				result = { checked };
				open = false;
			}}
		>
			{c?.confirmLabel ?? 'Confirm'}
		</Button>
	{/snippet}
</Dialog>
