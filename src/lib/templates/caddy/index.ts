import { Globe, ShieldCheck } from '@lucide/svelte';
import type { Template } from '../types';
import Form from './Form.svelte';
import Domains from './Domains.svelte';

export interface CaddyValues {
	email: string;
}

const caddy: Template<CaddyValues> = {
	id: 'caddy',
	name: 'Caddy reverse proxy',
	description:
		'Domains with automatic HTTPS for your projects — adds a Domains tab to every project.',
	icon: ShieldCheck,
	badge: 'Caddy',
	defaultName: 'caddy',
	defaults: () => ({ email: '' }),
	form: Form,
	tabs: [{ id: 'domains', label: 'Domains', icon: Globe, component: Domains }]
};

export default caddy;
