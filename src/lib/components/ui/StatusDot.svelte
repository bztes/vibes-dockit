<script lang="ts">
	import { statusDot } from './variants';

	type Tone = 'running' | 'partial' | 'unhealthy' | 'stopped' | 'not-deployed' | 'busy';
	let {
		tone,
		pulse = false,
		class: className,
		title
	}: { tone: Tone; pulse?: boolean; class?: string; title?: string } = $props();
</script>

<span class={statusDot({ tone, pulse, class: className })} {title}></span>
