import { Router } from '@lucide/svelte';
import type { Template } from '../types';
import Form from './Form.svelte';
import type { DdnsValues } from './ddns-updater';

const ddns: Template<DdnsValues> = {
	id: 'ddns-updater',
	name: 'Dynamic DNS',
	description: 'Keeps DNS records pointed at your public IP, using ddns-updater.',
	icon: Router,
	badge: 'DDNS',
	defaultName: 'ddns-updater',
	defaults: () => ({ config: '' }),
	form: Form
};

export default ddns;
