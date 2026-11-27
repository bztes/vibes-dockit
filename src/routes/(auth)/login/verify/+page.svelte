<script lang="ts">
	import { ShieldCheck } from '@lucide/svelte';
	import { logout, verifyLogin } from '#lib/remote/auth.remote.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Input from '#lib/components/ui/Input.svelte';

	let recovery = $state(false);
</script>

<svelte:head><title>Two-factor authentication · Dockit</title></svelte:head>

<h1 class="text-lg font-semibold">Two-factor authentication</h1>
<p class="mt-1 mb-6 text-sm text-zinc-500">
	{#if recovery}
		Enter one of your recovery codes. Each code works only once.
	{:else}
		Enter the 6-digit code from your authenticator app.
	{/if}
</p>

<form {...verifyLogin} class="grid gap-4">
	{#key recovery}
		<Field label={recovery ? 'Recovery code' : 'Code'}>
			<Input
				{...verifyLogin.fields._code.as('text')}
				autocomplete="one-time-code"
				inputmode={recovery ? 'text' : 'numeric'}
				placeholder={recovery ? 'xxxxx-xxxxx' : '123456'}
				class="font-mono tracking-widest"
				required
				autofocus
			/>
		</Field>
	{/key}
	{#each verifyLogin.fields.allIssues() ?? [] as issue (issue.message)}
		<Alert tone="danger" size="sm">{issue.message}</Alert>
	{/each}
	<Button type="submit" variant="primary" class="mt-2 w-full" loading={!!verifyLogin.pending}>
		<ShieldCheck /> Verify
	</Button>
</form>

<div class="mt-4 flex items-center justify-between text-sm">
	<button
		type="button"
		class="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
		onclick={() => (recovery = !recovery)}
	>
		{recovery ? 'Use authenticator app' : 'Use a recovery code'}
	</button>
	<form {...logout}>
		<button type="submit" class="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
			Cancel
		</button>
	</form>
</div>
