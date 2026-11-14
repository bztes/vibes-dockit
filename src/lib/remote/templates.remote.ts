import * as v from 'valibot';
import { command, query } from '$app/server';
import { requireUser, requireUserCommand } from '#lib/server/auth.js';
import { logActivity } from '#lib/server/db/index.js';
import { runProjectAction } from '#lib/server/actions.js';
import {
	NAME_RE,
	createProjectFolder,
	loadProject,
	projectDir,
	validateCompose
} from '#lib/server/projects.js';
import { getServerTemplate, projectTabs, templateAvailability } from '#lib/server/templates.js';

const projectName = v.pipe(v.string(), v.regex(NAME_RE, 'Invalid project name'));

/** Which templates can be used right now. */
export const getTemplates = query(async () => {
	requireUser();
	return templateAvailability();
});

/** Tabs templates add to a project. */
export const getProjectTabs = query(projectName, async (name) => {
	requireUser();
	return projectTabs(await loadProject(name));
});

export const createFromTemplate = command(
	v.object({
		template: v.string(),
		name: projectName,
		values: v.record(v.string(), v.unknown()),
		deploy: v.optional(v.boolean(), false)
	}),
	async ({ template: id, name, values, deploy }) => {
		const me = requireUserCommand();
		const template = getServerTemplate(id);
		if (!template) return { error: `Unknown template ${id}`, jobId: null };
		const unavailable = await template.unavailable?.();
		if (unavailable) return { error: unavailable, jobId: null };
		const parsed = v.safeParse(template.schema, values);
		if (!parsed.success) return { error: parsed.issues[0].message, jobId: null };

		const { compose, env = '' } = await template.create(parsed.output);
		const problem = await validateCompose(projectDir(name), compose, env);
		if (problem) return { error: problem, jobId: null };
		await createProjectFolder(name, compose, env);
		await template.afterCreate?.(name);
		await logActivity({
			project: name,
			type: 'create',
			level: 'success',
			message: `Created from template ${id} by ${me.username}`
		});
		void getTemplates().refresh();
		const jobId = deploy ? (await runProjectAction(name, 'up', me.username)).id : null;
		return { error: null, jobId };
	}
);
