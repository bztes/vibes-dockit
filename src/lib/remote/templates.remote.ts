import * as v from 'valibot';
import { command, query } from '$app/server';
import { requireUser, requireUserCommand } from '#lib/server/auth.js';
import { logActivity } from '#lib/server/db/index.js';
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
		values: v.record(v.string(), v.unknown())
	}),
	async ({ template: id, name, values }) => {
		const me = requireUserCommand();
		const template = getServerTemplate(id);
		if (!template) return { error: `Unknown template ${id}` };
		const unavailable = await template.unavailable?.();
		if (unavailable) return { error: unavailable };
		const parsed = v.safeParse(template.schema, values);
		if (!parsed.success) return { error: parsed.issues[0].message };

		const { compose, env = '', files } = await template.create(parsed.output);
		const problem = await validateCompose(projectDir(name), compose, env);
		if (problem) return { error: problem };
		await createProjectFolder(name, compose, env, files);
		await template.afterCreate?.(name);
		await logActivity({
			project: name,
			type: 'create',
			level: 'success',
			message: `Created from template ${id} by ${me.username}`
		});
		void getTemplates().refresh();
		return { error: null };
	}
);
