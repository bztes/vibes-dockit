import { DatabaseBackup } from '@lucide/svelte';
import type { Template } from '../types';
import Form from './Form.svelte';
import Backups from './Backups.svelte';

export interface ResticValues {
	/** folder on this host or restic repository string */
	repository: string;
	/** credentials of a rest: repository */
	restUser: string;
	restPassword: string;
	/** encrypts the repository */
	password: string;
	keepDaily: number;
	keepWeekly: number;
	keepMonthly: number;
	/** the repository refuses deletes: no retention and no prune */
	appendOnly: boolean;
}

const restic: Template<ResticValues> = {
	id: 'restic',
	name: 'Restic backups',
	description:
		'Incremental, encrypted backups of project folders and volumes — adds a Backups tab to every project.',
	icon: DatabaseBackup,
	badge: 'Restic',
	defaultName: 'restic',
	defaults: () => ({
		repository: '/srv/backups/restic',
		restUser: '',
		restPassword: '',
		password: '',
		keepDaily: 7,
		keepWeekly: 4,
		keepMonthly: 6,
		appendOnly: false
	}),
	form: Form,
	tabs: [{ id: 'backups', label: 'Backups', icon: DatabaseBackup, component: Backups }]
};

export default restic;
