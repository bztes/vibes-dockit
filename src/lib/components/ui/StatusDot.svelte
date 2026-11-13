<script lang="ts">
	import { statusDot } from './variants';

	type Tone = 'running' | 'partial' | 'unhealthy' | 'stopped' | 'not-deployed' | 'busy';
	let {
		tone,
		pulse = false,
		class: className
	}: { tone: Tone; pulse?: boolean; class?: string } = $props();
</script>

<span class={statusDot({ tone, pulse, class: className })}></span>
