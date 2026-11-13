<script lang="ts">
	import Logo from '#lib/components/app/Logo.svelte';
	let { children } = $props();
</script>

<div class="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-12">
	<div
		class="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--color-zinc-500)/8_1px,transparent_1px),linear-gradient(to_bottom,var(--color-zinc-500)/8_1px,transparent_1px)] mask-[radial-gradient(ellipse_at_center,black,transparent_70%)] bg-size-[32px_32px]"
	></div>
	<div class="relative w-full max-w-sm animate-slide-up">
		<div class="mb-8 flex justify-center"><Logo size="lg" /></div>
		<div
			class="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
		>
			{@render children()}
		</div>
	</div>
</div>
