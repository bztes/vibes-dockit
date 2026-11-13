import * as v from 'valibot';
import { command, query } from '$app/server';
import { requireUser, requireUserCommand } from '#lib/server/auth.js';
import { logActivity } from '#lib/server/db/index.js';
import { runProjectAction } from '#lib/server/actions.js';
import {
	createCaddyProject,
	getCaddy,
	invalidateCaddy,
	readProjectProxy,
	saveProjectProxy
} from '#lib/server/caddy.js';
import { NAME_RE } from '#lib/server/projects.js';
import { DOMAIN_RE, normalizeDomain } from '#lib/proxy.js';
import { getFiles } from './projects.remote';

const projectName = v.pipe(v.string(), v.regex(NAME_RE, 'Invalid project name'));

const domain = v.pipe(
	v.string(),
	v.transform(normalizeDomain),
	v.regex(DOMAIN_RE, 'Invalid domain')
);

export const getCaddyStatus = query(async () => {
	requireUser();
	return getCaddy();
});

export const setupCaddy = command(
	v.object({
		email: v.optional(v.union([v.literal(''), v.pipe(v.string(), v.trim(), v.email())]))
	}),
	async ({ email }) => {
		const me = requireUserCommand();
		const name = await createCaddyProject(email || undefined);
		await logActivity({
			project: name,
			type: 'create',
			level: 'success',
			message: `Caddy reverse proxy created by ${me.username}`
		});
		const job = await runProjectAction(name, 'up', me.username);
		invalidateCaddy();
		void getCaddyStatus().refresh();
		return { project: name, jobId: job.id };
	}
);

export const getProxy = query(projectName, async (name) => {
	requireUser();
	return readProjectProxy(name);
});

export const saveProxy = command(
	v.object({
		name: projectName,
		routes: v.array(
			v.object({
				service: v.pipe(v.string(), v.nonEmpty()),
				port: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
				domains: v.pipe(v.array(domain), v.minLength(1, 'Every route needs a domain'))
			})
		),
		deploy: v.optional(v.boolean(), false)
	}),
	async ({ name, routes, deploy }) => {
		const me = requireUserCommand();
		const problem = await saveProjectProxy(name, routes);
		if (problem) return { error: problem, jobId: null };
		await logActivity({
			project: name,
			type: 'edit',
			message: `Domains changed by ${me.username}`
		});
		void getProxy(name).refresh();
		void getFiles(name).refresh();
		const jobId = deploy ? (await runProjectAction(name, 'up', me.username)).id : null;
		return { error: null, jobId };
	}
);
