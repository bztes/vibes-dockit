<script lang="ts">
	import { ExternalLink, Info, Plus, Rocket, Save, Trash } from '@lucide/svelte';
	import { saveProxy } from './caddy.remote';
	import Button from '#lib/components/ui/Button.svelte';
	import Input from '#lib/components/ui/Input.svelte';
	import Select from '#lib/components/ui/Select.svelte';
	import { openJob } from '#lib/components/app/jobs.svelte.js';
	import { toast } from '#lib/components/ui/toast.svelte.js';
	import {
		DOMAIN_RE,
		domainUrl,
		normalizeExportTarget,
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
		/** folder to export the certificates to, empty for none */
		export: string;
	}

	let nextId = 0;
	const toDrafts = (list: Service[]): Draft[] =>
		list.flatMap((s) =>
			s.routes.map((r) => ({
				id: nextId++,
				service: r.service,
				port: r.port,
				domains: r.domains.join(', '),
				export: r.export ?? ''
			}))
		);

	// the parent re-mounts this component when the stored routes change
	// svelte-ignore state_referenced_locally
	const initial = toDrafts(services);
	let drafts = $state(initial.map((d) => ({ ...d })));
	let saving = $state<'save' | 'deploy' | null>(null);
	let problem = $state<string | null>(null);

	const editable = $derived(services.filter((s) => !s.networkMode));
	const locked = $derived(services.filter((s) => s.networkMode));

	const normalize = (d: Draft) => ({
		service: d.service,
		port: d.port,
		domains: splitDomains(d.domains),
		export: d.export.trim() ? normalizeExportTarget(d.export) : undefined
	});
	const normalized = $derived(drafts.map(normalize));
	const dirty = $derived(JSON.stringify(normalized) !== JSON.stringify(initial.map(normalize)));
	const invalid = $derived(
		normalized.some(
			(r) =>
				!r.service ||
				!r.port ||
				r.port < 1 ||
				r.port > 65535 ||
				r.domains.length === 0 ||
				r.domains.some((d) => !DOMAIN_RE.test(d)) ||
				r.export === null
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

	/** certificate mounts are part of the service → the container has to be recreated */
	const exportsOf = (list: ReturnType<typeof normalize>[]) =>
		JSON.stringify(list.filter((r) => r.export).map((r) => [r.service, r.export, r.domains]));
	const mountsChanged = $derived(exportsOf(normalized) !== exportsOf(initial.map(normalize)));
	const needsDeploy = $derived(disconnected.length > 0 || mountsChanged);

	function add() {
		const used = new Set(drafts.map((d) => d.service));
		const service = editable.find((s) => !used.has(s.service)) ?? editable[0];
		drafts.push({
			id: nextId++,
			service: service?.service ?? '',
			port: service?.ports[0] ?? 80,
			domains: '',
			export: ''
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
					export: r.export ?? undefined
				}))
			});
			if (res.error) {
				problem = res.error;
				return;
			}
			if (deploy) toast.success('Domains applied, deploying…');
			else if (needsDeploy) toast.success('Domains applied — deploy to apply them to the services');
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
	{#if drafts.length === 0}
		<p class="text-sm text-zinc-500">
			No domains yet. Add a route to make a service reachable through Caddy.
		</p>
	{:else}
		<div
			class="hidden gap-3 text-xs font-medium text-zinc-500 sm:grid sm:grid-cols-[10rem_1fr_6rem_9rem_2rem]"
		>
			<span>Service</span><span>Domains</span><span>Port</span><span>Export certs</span><span
			></span>
		</div>
		{#each drafts as draft (draft.id)}
			{@const domains = splitDomains(draft.domains)}
			{@const bad = domains.filter((d) => !DOMAIN_RE.test(d))}
			{@const suggestions = serviceOf(draft.service)?.ports ?? []}
			<div class="grid items-start gap-3 sm:grid-cols-[10rem_1fr_6rem_9rem_2rem]">
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
				<div class="grid gap-1.5">
					<Input
						bind:value={draft.export}
						placeholder="/certs"
						title="Mounts the certificate (.crt, full chain) and key (.key) Caddy obtained into this folder of the container (read-only)"
						aria-label="Export certificates to folder"
						aria-invalid={draft.export.trim() !== '' && !normalizeExportTarget(draft.export)}
						mono
					/>
					{#if draft.export.trim() && !normalizeExportTarget(draft.export)}
						<p class="text-xs text-red-600 dark:text-red-400">Absolute path, e.g. /certs</p>
					{/if}
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

	{#if mountsChanged}
		<p class="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
			<Info class="mt-px size-3.5 shrink-0" />
			<span
				>Certificate exports are mounted from Caddy's data volume — deploy to apply them. The files
				are owned by root (mode 600), the service has to read them as root.</span
			>
		</p>
	{/if}

	{#if problem}
		<pre
			class="rounded-lg bg-red-500/5 p-3 font-mono text-xs whitespace-pre-wrap text-red-600 dark:text-red-400">{problem}</pre>
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
