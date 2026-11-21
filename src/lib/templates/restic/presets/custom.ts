import type { HookSet } from '../hooks';
import type { PresetDef } from './shared';

export default {
	label: 'Empty (custom hooks)',
	description: 'No scripts yet: write your own hooks.',
	keepsVolumes: true,
	hooks: (): HookSet => ({})
} satisfies PresetDef;
