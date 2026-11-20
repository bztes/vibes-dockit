import * as v from 'valibot';
import { command, query } from '$app/server';
import { requireUser, requireUserCommand } from '#lib/server/auth.js';
import { logActivity } from '#lib/server/db/index.js';
import { runProjectAction } from '#lib/server/actions.js';
import { NAME_RE } from '#lib/server/projects.js';
import { getFiles } from '#lib/remote/projects.remote.js';
import { getProjectTabs } from '#lib/remote/templates.remote.js';
import { getCaddy, readProjectProxy, saveProjectProxy } from './caddy.server';
import { DOMAIN_RE, normalizeDomain, normalizeExportTarget } from './proxy';

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
				domains: v.pipe(v.array(domain), v.minLength(1, 'Every route needs a domain')),
				export: v.optional(
					v.pipe(
						v.string(),
						v.transform(normalizeExportTarget),
						v.check(
							(p) => p !== null,
							'The export folder has to be an absolute path in the container'
						),
						v.transform((p) => p ?? undefined)
					)
				)
			})
		),
		deploy: v.optional(v.boolean(), false)
	}),
	async ({ name, routes, deploy }) => {
		const me = requireUserCommand();
		// written and applied right away, deploying is only needed to join the caddy network
		const problem = await saveProjectProxy(name, routes);
		if (problem) {
			void getProxy(name).refresh();
			return { error: problem, jobId: null };
		}
		await logActivity({
			project: name,
			type: 'edit',
			message: `Domains changed by ${me.username}`
		});
		void getProxy(name).refresh();
		void getFiles(name).refresh();
		void getProjectTabs(name).refresh();
		const jobId = deploy ? (await runProjectAction(name, 'up', me.username)).id : null;
		return { error: null, jobId };
	}
);
