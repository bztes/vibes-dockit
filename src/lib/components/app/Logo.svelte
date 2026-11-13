<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	let { size = 'md' }: { size?: 'md' | 'lg' } = $props();
</script>

<span class="inline-flex items-center gap-2.5">
	<img src={favicon} alt="" class={size === 'lg' ? 'size-10' : 'size-7'} />
	<span
		class={[
			'font-semibold tracking-tight text-zinc-900 dark:text-white',
			size === 'lg' ? 'text-2xl' : 'text-lg'
		]}>Dockit</span
	>
</span>
