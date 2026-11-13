import path from 'node:path';
import { defineEnvVars } from '@sveltejs/kit/env';

const optional = (value: string | undefined) => (value && value.trim() ? value.trim() : undefined);

export const variables = defineEnvVars({
	DOCKIT_DATA_DIR: {
		description: 'Directory where dockit stores its config.json and sqlite database (dockit.db).',
		schema: (value) => optional(value) ?? './data'
	},
	PROJECTS_ROOT: {
		description:
			'Required. Absolute path of the folder that contains the compose projects. In docker, mount it with the same path as on the host.',
		// optional here because the build also loads this; required + existence check happen in the init hook
		schema: (value) => {
			const root = optional(value);
			if (root && !path.isAbsolute(root))
				throw new Error(`PROJECTS_ROOT must be an absolute path: ${root}`);
			return root && path.resolve(root);
		}
	},
	DOCKIT_SELF_PROJECT: {
		description: 'Folder name of the project that runs dockit itself (auto-detected in docker).',
		schema: optional
	}
});
