<script lang="ts">
	import { Copy, KeyRound, ShieldCheck, ShieldOff } from '@lucide/svelte';
	import {
		enableTotp,
		getMfaStatus,
		newRecoveryCodes,
		startTotp,
		turnOffTotp
	} from '#lib/remote/mfa.remote.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Input from '#lib/components/ui/Input.svelte';
	import { toast } from '#lib/components/ui/toast.svelte.js';

	const status = $derived(await getMfaStatus());

	let setup = $state<{ secret: string; qr: string } | null>(null);
	let starting = $state(false);
	/** shown once after enabling or regenerating */
	let codes = $state<string[] | null>(null);
	let passwordFor = $state<'off' | 'codes' | null>(null);
	let passwordOpen = $state(false);

	async function begin() {
		starting = true;
		try {
			setup = await startTotp();
		} catch (e) {
			toast.error('Could not start setup', e);
		} finally {
			starting = false;
		}
	}

	function askPassword(kind: 'off' | 'codes') {
		passwordFor = kind;
		passwordOpen = true;
	}

	async function copyCodes() {
		if (!codes) return;
		try {
			await navigator.clipboard.writeText(codes.join('\n'));
			toast.success('Recovery codes copied');
		} catch (e) {
			toast.error('Could not copy', e);
		}
	}

	const modes = {
		off: {
			form: turnOffTotp,
			title: 'Turn off two-factor auth?',
			description: 'Signing in will only need your password again.',
			variant: 'danger',
			label: 'Turn off'
		},
		codes: {
			form: newRecoveryCodes,
			title: 'New recovery codes',
			description: 'Your old recovery codes stop working.',
			variant: 'primary',
			label: 'Create new codes'
		}
	} as const;
	const mode = $derived(modes[passwordFor ?? 'codes']);
</script>

<Card
	title="Two-factor authentication"
	description="Ask for a code from an authenticator app after the password."
>
	{#snippet actions()}
		{#if status.totp}
			<Badge tone="success"><ShieldCheck class="text-emerald-500" />On</Badge>
		{:else}
			<Badge>Off</Badge>
		{/if}
	{/snippet}

	{#if codes}
		<div class="grid gap-4">
			<p class="text-sm">
				Save these recovery codes somewhere safe (for example in your password manager). Each one
				lets you sign in once if you lose your phone. <strong>They are shown only now.</strong>
			</p>
			<ul
				class="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-zinc-50 p-4 font-mono text-sm dark:bg-zinc-800/50"
			>
				{#each codes as code (code)}<li>{code}</li>{/each}
			</ul>
			<div class="flex justify-end gap-2">
				<Button variant="outline" onclick={copyCodes}><Copy /> Copy</Button>
				<Button variant="primary" onclick={() => (codes = null)}>I saved them</Button>
			</div>
		</div>
	{:else if status.totp}
		<div class="flex flex-wrap items-center justify-between gap-3">
			<p class="text-sm text-zinc-500">
				{status.recoveryCodes} recovery codes left.
			</p>
			<div class="flex gap-2">
				<Button size="sm" variant="outline" onclick={() => askPassword('codes')}
					><KeyRound /> New recovery codes</Button
				>
				<Button size="sm" variant="danger-ghost" onclick={() => askPassword('off')}
					><ShieldOff /> Turn off</Button
				>
			</div>
		</div>
	{:else if setup}
		<div class="grid gap-5 sm:grid-cols-[10rem_1fr]">
			<div class="rounded-lg bg-white p-2 [&_svg]:h-auto [&_svg]:w-full">
				<!-- server-generated svg from our own otpauth uri -->
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html setup.qr}
			</div>
			<div class="grid content-start gap-3 text-sm">
				<p>
					Scan the QR code with an authenticator app (Aegis, 2FAS, Google Authenticator, 1Password,
					Bitwarden, …). Can't scan it? Enter this key instead:
				</p>
				<code class="font-mono text-xs break-all select-all">{setup.secret}</code>
				<form
					{...enableTotp.enhance(async ({ element, submit }) => {
						if (await submit()) {
							element.reset();
							const result = enableTotp.result?.recoveryCodes;
							if (result) {
								codes = result;
								setup = null;
								toast.success('Two-factor authentication is on');
							}
						}
					})}
					class="grid gap-3"
				>
					<Field label="Code from the app" issues={enableTotp.fields._code.issues()}>
						<Input
							{...enableTotp.fields._code.as('text')}
							inputmode="numeric"
							autocomplete="one-time-code"
							placeholder="123456"
							class="font-mono tracking-widest"
							required
						/>
					</Field>
					<div class="flex justify-end gap-2">
						<Button variant="ghost" onclick={() => (setup = null)}>Cancel</Button>
						<Button type="submit" variant="primary" loading={!!enableTotp.pending}
							><ShieldCheck /> Turn on</Button
						>
					</div>
				</form>
			</div>
		</div>
	{:else}
		<div class="flex justify-end">
			<Button variant="primary" loading={starting} onclick={begin}><ShieldCheck /> Set up</Button>
		</div>
	{/if}
</Card>

<Dialog bind:open={passwordOpen} size="sm" title={mode.title} description={mode.description}>
	{#key passwordFor}
		<form
			{...mode.form.enhance(async ({ element, submit }) => {
				if (await submit()) {
					element.reset();
					passwordOpen = false;
					if (passwordFor === 'off') toast.success('Two-factor authentication is off');
					else codes = newRecoveryCodes.result?.recoveryCodes ?? null;
				}
			})}
			class="grid gap-4"
		>
			<Field label="Your password" issues={mode.form.fields._password.issues()}>
				<Input
					{...mode.form.fields._password.as('password')}
					autocomplete="current-password"
					required
				/>
			</Field>
			<div class="flex justify-end gap-2">
				<Button variant="ghost" onclick={() => (passwordOpen = false)}>Cancel</Button>
				<Button type="submit" variant={mode.variant} loading={!!mode.form.pending}>
					{mode.label}
				</Button>
			</div>
		</form>
	{/key}
</Dialog>
