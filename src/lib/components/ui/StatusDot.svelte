<script module lang="ts">
	import { tv } from 'tailwind-variants';

	export const statusDot = tv({
		base: 'relative inline-flex size-2 shrink-0 rounded-full',
		variants: {
			tone: {
				running: 'bg-success',
				partial: 'bg-warning',
				unhealthy: 'bg-danger',
				stopped: 'bg-zinc-400 dark:bg-zinc-600',
				'not-deployed':
					'bg-zinc-300 ring-1 ring-zinc-400 ring-inset dark:bg-transparent dark:ring-zinc-600',
				busy: 'bg-primary'
			},
			pulse: {
				true: 'after:absolute after:inset-0 after:animate-ping after:rounded-full after:bg-inherit after:opacity-60'
			}
		}
	});
</script>

<script lang="ts">
	type Tone = 'running' | 'partial' | 'unhealthy' | 'stopped' | 'not-deployed' | 'busy';
	let {
		tone,
		pulse = false,
		class: className,
		title
	}: { tone: Tone; pulse?: boolean; class?: string; title?: string } = $props();
</script>

<span class={statusDot({ tone, pulse, class: className })} {title}></span>
