<script lang="ts">
	import { Eye, EyeOff, KeyRound, Lock, Plus, Trash2 } from '@lucide/svelte';
	import {
		SECRET_MASK,
		hasPlainComments,
		parseEnv,
		serializeEnv,
		type EnvEntry
	} from '#lib/env.js';
	import Button from '#lib/components/ui/Button.svelte';
	import Input from '#lib/components/ui/Input.svelte';

	let { value = $bindable(''), onsave }: { value: string; onsave?: () => void } = $props();

	let reveal = $state(false);
	// rows are edited locally and serialized back into `value`
	let rows = $state<EnvEntry[]>([]);
	let lastSerialized = '';

	$effect.pre(() => {
		if (value !== lastSerialized) {
			rows = parseEnv(value);
			lastSerialized = value;
		}
	});

	function commit() {
		lastSerialized = serializeEnv(rows);
		value = lastSerialized;
	}

	function keydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 's') {
			e.preventDefault();
			onsave?.();
		}
	}

	const hasComments = $derived(hasPlainComments(value));
	const hasSecrets = $derived(rows.some((r) => r.secret));
	const SENSITIVE = /pass|secret|token|key|pwd/i;
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="grid gap-3" onkeydown={keydown}>
	{#if hasComments}
		<p class="text-xs text-amber-600 dark:text-amber-400">
			The .env file contains comments. They are removed when you save.
		</p>
	{/if}

	<div class="grid gap-2">
		{#each rows as row, i (i)}
			<div class="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-2">
				<div class="relative">
					{#if row.secret}
						<Lock
							class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-amber-500"
						/>
					{/if}
					<Input
						bind:value={row.key}
						oninput={commit}
						mono
						placeholder={row.secret ? 'SECRET_KEY' : 'KEY'}
						aria-label="Variable name"
						size="sm"
						class={row.secret ? 'pl-8' : ''}
					/>
				</div>
				{#if row.secret}
					<!-- write-only: the stored value is never sent to the browser -->
					<Input
						value={row.value === SECRET_MASK ? '' : row.value}
						oninput={(e) => {
							row.value = e.currentTarget.value || SECRET_MASK;
							commit();
						}}
						mono
						size="sm"
						type="password"
						placeholder={row.value === SECRET_MASK
							? '•••••••• stored — type to replace'
							: 'secret value'}
						aria-label="Secret value"
						autocomplete="new-password"
					/>
				{:else}
					<Input
						bind:value={row.value}
						oninput={commit}
						mono
						size="sm"
						placeholder="value"
						aria-label="Value"
						type={!reveal && SENSITIVE.test(row.key) ? 'password' : 'text'}
						autocomplete="off"
					/>
				{/if}
				<Button
					size="icon-sm"
					variant="danger-ghost"
					aria-label="Remove variable"
					onclick={() => {
						rows.splice(i, 1);
						commit();
					}}><Trash2 /></Button
				>
			</div>
		{:else}
			<p class="py-4 text-center text-sm text-zinc-500">No environment variables yet.</p>
		{/each}
	</div>

	<div class="flex flex-wrap items-center gap-2">
		<Button size="sm" onclick={() => rows.push({ key: '', value: '', secret: false })}>
			<Plus /> Add variable
		</Button>
		<Button size="sm" onclick={() => rows.push({ key: '', value: '', secret: true })}>
			<KeyRound /> Add secret
		</Button>
		{#if rows.some((r) => !r.secret && SENSITIVE.test(r.key))}
			<Button size="sm" variant="ghost" onclick={() => (reveal = !reveal)}>
				{#if reveal}<EyeOff /> Hide values{:else}<Eye /> Show values{/if}
			</Button>
		{/if}
		{#if hasSecrets}
			<p class="text-xs text-zinc-500">
				Secrets are write-only: stored in .env, but never shown again.
			</p>
		{/if}
	</div>
</div>
