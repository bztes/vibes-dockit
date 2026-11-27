<script lang="ts">
	import { CornerDownRight, ExternalLink, Info, Plus, Rocket, Save, Trash } from '@lucide/svelte';
	import { saveProxy } from './caddy.remote';
	import Button from '#lib/components/ui/Button.svelte';
	import ErrorOutput from '#lib/components/ui/ErrorOutput.svelte';
	import Input from '#lib/components/ui/Input.svelte';
	import Select from '#lib/components/ui/Select.svelte';
	import Switch from '#lib/components/ui/Switch.svelte';
	import StaleDraft from '#lib/components/app/StaleDraft.svelte';
	import { draftKey, useDraft, type Draft as Unsaved } from '#lib/components/app/drafts.svelte.js';
	import { openJob } from '#lib/components/app/jobs.svelte.js';
	import { toast } from '#lib/components/ui/toast.svelte.js';
	import {
		DOMAIN_RE,
		domainUrl,
		redundantPublished,
		splitDomains,
		type ConnectedService
	} from './proxy';

	type Service = ConnectedService;

	let { name, services, network }: { name: string; services: Service[]; network: string } =
		$props();

	interface Draft {
		id: number;
		service: string;
		port: number | undefined;
		domains: string;
		/** domains that redirect to the first domain */
		redirects: string;
		/** the redirects input is shown */
		showRedirects: boolean;
		/** link the certificates into the project folder */
		certs: boolean;
	}

	let nextId = 0;
	const toDrafts = (list: Service[]): Draft[] =>
		list.flatMap((s) =>
			s.routes.map((r) => ({
				id: nextId++,
				service: r.service,
				port: r.port,
				domains: r.domains.join(', '),
				redirects: (r.redirects ?? []).join(', '),
				showRedirects: !!r.redirects?.length,
				certs: r.certs ?? false
			}))
		);

	// the parent re-mounts this component when the stored routes change
	// svelte-ignore state_referenced_locally
	const initial = toDrafts(services);
	// svelte-ignore state_referenced_locally
	const unsaved: Unsaved<Draft[]> = useDraft(draftKey(name, 'domains'), {
		base: () => base,
		dirty: () => dirty,
		value: () => drafts
	});
	const saved = unsaved.saved;
	if (saved) nextId = Math.max(nextId, ...saved.map((d) => d.id + 1));
	let drafts = $state((saved ?? initial).map((d) => ({ ...d })));
	let saving = $state<'save' | 'deploy' | null>(null);
	let problem = $state<string | null>(null);

	const editable = $derived(services.filter((s) => !s.networkMode));
	const locked = $derived(services.filter((s) => s.networkMode));

	const normalize = (d: Draft) => ({
		service: d.service,
		port: d.port,
		domains: splitDomains(d.domains),
		redirects: splitDomains(d.redirects ?? ''),
		certs: d.certs || undefined
	});
	const normalized = $derived(drafts.map(normalize));
	const base = JSON.stringify(initial.map(normalize));
	const dirty = $derived(JSON.stringify(normalized) !== base);
	const invalid = $derived(
		normalized.some(
			(r) =>
				!r.service ||
				!r.port ||
				r.port < 1 ||
				r.port > 65535 ||
				r.domains.length === 0 ||
				[...r.domains, ...r.redirects].some((d) => !DOMAIN_RE.test(d))
		)
	);

	/** published ports caddy already routes to → not needed anymore */
	const redundant = $derived(
		services
			.map((s) => ({
				service: s.service,
				ports: redundantPublished(
					s.published,
					normalized.filter((r) => r.service === s.service).map((r) => Number(r.port))
				)
			}))
			.filter((s) => s.ports.length)
	);

	const serviceOf = (service: string) => services.find((s) => s.service === service);

	/** routed services whose container is not on the caddy network yet → deploy */
	const disconnected = $derived([
		...new Set(drafts.map((d) => d.service).filter((s) => s && !serviceOf(s)?.connected))
	]);

	const needsDeploy = $derived(disconnected.length > 0);

	function add() {
		const used = new Set(drafts.map((d) => d.service));
		const service = editable.find((s) => !used.has(s.service)) ?? editable[0];
		drafts.push({
			id: nextId++,
			service: service?.service ?? '',
			port: service?.ports[0] ?? 80,
			domains: '',
			redirects: '',
			showRedirects: false,
			certs: false
		});
	}

	function changeService(draft: Draft, service: string) {
		draft.service = service;
		const ports = serviceOf(service)?.ports ?? [];
		if (ports.length && (!draft.port || !ports.includes(draft.port))) draft.port = ports[0];
	}

	async function save(deploy: boolean) {
		saving = deploy ? 'deploy' : 'save';
		problem = null;
		try {
			const res = await saveProxy({
				name,
				deploy,
				routes: normalized.map((r) => ({
					...r,
					port: Number(r.port),
					redirects: r.redirects.length ? r.redirects : undefined
				}))
			});
			if (res.error) {
				problem = res.error;
				return;
			}
			// the parent re-mounts this component with the saved routes
			unsaved.drop();
			if (deploy) toast.success('Domains applied, deploying…');
			else if (needsDeploy) toast.success('Domains applied — deploy to connect the services');
			else toast.success('Domains applied');
			if (res.jobId) openJob(res.jobId);
		} catch (e) {
			toast.error('Could not save domains', e);
		} finally {
			saving = null;
		}
	}
</script>

<div class="grid gap-4">
	<StaleDraft
		draft={unsaved}
		what="The domains"
		ondiscard={() => (drafts = initial.map((d) => ({ ...d })))}
	/>
	{#if drafts.length === 0}
		<p class="text-sm text-zinc-500">
			No domains yet. Add a route to make a service reachable through Caddy.
		</p>
	{:else}
		<div
			class="hidden gap-3 text-xs font-medium text-zinc-500 sm:grid sm:grid-cols-[10rem_1fr_6rem_4rem_2rem]"
		>
			<span>Service</span><span>Domains</span><span>Port</span><span>Certs</span><span></span>
		</div>
		{#each drafts as draft (draft.id)}
			{@const domains = splitDomains(draft.domains)}
			{@const bad = domains.filter((d) => !DOMAIN_RE.test(d))}
			{@const redirects = splitDomains(draft.redirects ?? '')}
			{@const badRedirects = redirects.filter((d) => !DOMAIN_RE.test(d))}
			{@const suggestions = serviceOf(draft.service)?.ports ?? []}
			<div class="grid items-start gap-3 sm:grid-cols-[10rem_1fr_6rem_4rem_2rem]">
				<Select
					value={draft.service}
					onchange={(e) => changeService(draft, e.currentTarget.value)}
					aria-label="Service"
				>
					{#each editable as s (s.service)}
						<option value={s.service}>{s.service}</option>
					{/each}
				</Select>
				<div class="grid gap-1.5">
					<Input
						bind:value={draft.domains}
						placeholder="app.example.com, www.example.com"
						aria-label="Domains"
						aria-invalid={bad.length > 0}
						mono
					/>
					{#if bad.length}
						<p class="text-xs text-red-600 dark:text-red-400">Invalid: {bad.join(', ')}</p>
					{:else if domains.length}
						<p class="flex flex-wrap gap-x-3 gap-y-1 text-xs">
							{#each domains as d (d)}
								<a
									href={domainUrl(d)}
									target="_blank"
									rel="noreferrer"
									class="inline-flex items-center gap-1 text-link hover:underline"
									>{d}<ExternalLink class="size-3" /></a
								>
							{/each}
						</p>
					{/if}
					{#if draft.showRedirects}
						<div class="flex items-center gap-2">
							<CornerDownRight class="size-4 shrink-0 text-zinc-400" />
							<Input
								bind:value={draft.redirects}
								placeholder="www.example.com"
								aria-label="Domains that redirect to {domains[0] ?? 'the first domain'}"
								aria-invalid={badRedirects.length > 0}
								mono
							/>
						</div>
						{#if badRedirects.length}
							<p class="text-xs text-red-600 dark:text-red-400">
								Invalid: {badRedirects.join(', ')}
							</p>
						{:else}
							<p class="text-xs text-zinc-500">
								Redirect permanently to <code class="font-mono"
									>{domains[0] ?? 'the first domain'}</code
								>, keeping path and query.
							</p>
						{/if}
					{:else}
						<button
							type="button"
							class="justify-self-start text-xs text-zinc-500 hover:text-zinc-700 hover:underline dark:hover:text-zinc-300"
							onclick={() => (draft.showRedirects = true)}>+ Redirect other domains here</button
						>
					{/if}
				</div>
				<div>
					<Input
						bind:value={draft.port}
						type="number"
						min="1"
						max="65535"
						aria-label="Container port"
						list="ports-{draft.id}"
						mono
					/>
					<datalist id="ports-{draft.id}">
						{#each suggestions as p (p)}<option value={p}></option>{/each}
					</datalist>
				</div>
				<div
					class="sm:mt-2"
					title="Links the certificate (.crt, full chain) and key (.key) of every domain to certs/<domain> in the project folder"
				>
					<Switch
						bind:checked={draft.certs}
						aria-label="Link certificates into the project folder"
					/>
				</div>
				<Button
					size="icon"
					variant="danger-ghost"
					title="Remove route"
					aria-label="Remove route"
					onclick={() => drafts.splice(drafts.indexOf(draft), 1)}><Trash /></Button
				>
			</div>
		{/each}
	{/if}

	{#each locked as s (s.service)}
		<p class="flex items-start gap-2 text-xs text-zinc-500">
			<Info class="mt-px size-3.5 shrink-0" />
			<span
				><code class="font-mono">{s.service}</code> uses
				<code class="font-mono">network_mode: {s.networkMode}</code> and can't join the caddy network.</span
			>
		</p>
	{/each}

	{#each redundant as s (s.service)}
		{@const it = s.ports.length === 1 ? 'it' : 'them'}
		<p class="flex items-start gap-2 text-xs text-zinc-500">
			<Info class="mt-px size-3.5 shrink-0" />
			<span
				><code class="font-mono">{s.service}</code> still publishes
				<code class="font-mono">{s.ports.join(', ')}</code>. Caddy doesn't need {it} — remove {it} from
				<code class="font-mono">ports</code> in the configuration to keep the service private.</span
			>
		</p>
	{/each}

	{#if disconnected.length}
		<p class="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
			<Info class="mt-px size-3.5 shrink-0" />
			<span
				>{#each disconnected as s, i (s)}{i ? ', ' : ''}<code class="font-mono">{s}</code>{/each}
				{disconnected.length === 1 ? 'is' : 'are'} not connected to the
				<code class="font-mono">{network}</code> network yet. Deploy once to connect — later domain changes
				don't need a deploy.</span
			>
		</p>
	{/if}

	{#if drafts.some((d) => d.certs)}
		<p class="flex items-start gap-2 text-xs text-zinc-500">
			<Info class="mt-px size-3.5 shrink-0" />
			<span
				>The certificates are linked to <code class="font-mono">certs/&lt;domain&gt;</code> in the project
				folder, e.g. to mount them into a service. The files are owned by root (mode 600) as Caddy writes
				them.</span
			>
		</p>
	{/if}

	{#if problem}
		<ErrorOutput text={problem} />
	{/if}

	<div
		class="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800/60"
	>
		<Button variant="ghost" size="sm" onclick={add} disabled={editable.length === 0}
			><Plus /> Add route</Button
		>
		<div class="flex gap-2">
			<Button
				variant={needsDeploy ? undefined : 'primary'}
				onclick={() => save(false)}
				loading={saving === 'save'}
				disabled={!dirty || invalid || !!saving}><Save /> Save</Button
			>
			{#if needsDeploy}
				<Button
					variant="primary"
					onclick={() => save(true)}
					loading={saving === 'deploy'}
					disabled={invalid || !!saving}><Rocket /> {dirty ? 'Save & deploy' : 'Deploy'}</Button
				>
			{/if}
		</div>
	</div>
</div>
