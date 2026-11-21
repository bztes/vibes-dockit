import { existsSync, watch, type FSWatcher } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { containersOf, runProjectAction } from '#lib/server/actions.js';
import {
	inspectContainers,
	listContainers,
	listVolumes,
	parseImageRef,
	type Container,
	type ContainerDetails,
	type Volume
} from '#lib/server/docker.js';
import { CommandError, run, runOk } from '#lib/server/exec.js';
import { startJob, waitForJob, type JobContext } from '#lib/server/jobs.js';
import { logActivity } from '#lib/server/db/index.js';
import { notifyJobFailed } from '#lib/server/notify.js';
import { hostDockerSocket } from '#lib/server/self.js';
import { getSection, setSection } from '#lib/dockit-config.js';
import {
	getRoot,
	listProjects,
	loadProject,
	readSources,
	saveSources,
	type ProjectInfo
} from '#lib/server/projects.js';
import type { ServerTemplate } from '#lib/server/templates.js';
import type { ResticValues } from './index';
import {
	addHooks,
	hookCandidates,
	hookCommand,
	hookedServices,
	hooksSection,
	phaseScripts,
	readHooks,
	HOOKS_SECTION,
	type HookSet,
	type Hooks,
	type Phase
} from './hooks';
import type { Preset } from './presets';
import {
	dockitProfiles,
	envValue,
	localRepository,
	mainProfiles,
	parseSnapshots,
	profileName,
	projectTag,
	parseRepository,
	readRestic,
	repositoryProblem,
	resticSection,
	volumePath,
	CONFIG_DIR,
	VOLUMES_DIR,
	type ProfileSource,
	type ResticSettings,
	type Snapshot
} from './restic';

/**
 * Restic integration: the restic project runs resticprofile with crond. Its
 * `conf/profiles.yaml` (repository, password, retention, prune) belongs to the
 * user; the backup settings of all projects (`restic` in `dockit.json`) are written
 * to `conf/dockit.yaml` and scheduled with `resticprofile schedule --all`.
 * Scheduled backups run without Dockit, manual ones and restores are started
 * by Dockit with `docker exec`. The container has the docker CLI and socket for
 * the backup hooks.
 */
const RESTIC_IMAGE = 'creativeprojects/resticprofile:0.33.1';
/** provides the docker CLI for the hooks (a static binary) */
const DOCKER_CLI_IMAGE = 'docker:28-cli';
const REPOSITORY = 'creativeprojects/resticprofile';
const CONF_DIR = 'conf';
const MAIN_FILE = 'profiles.yaml';
const DOCKIT_FILE = 'dockit.yaml';
const PASSWORD_FILE = 'password';

/** resticprofile only adds jobs: the crontab is emptied first (`crontab -r` would break `crontab -l`) */
const SCHEDULE_ALL = 'crontab - </dev/null; resticprofile --no-ansi schedule --all';

/**
 * - ready / stopped: the restic project of this template (running or not)
 * - missing: there is no restic project
 */
type ResticState = 'ready' | 'stopped' | 'missing';

interface ResticInfo {
	state: ResticState;
	container: { id: string; name: string; state: string } | null;
	/** Dockit project that runs the restic container */
	project: string | null;
	dir: string | null;
	/** scheduling with the last configuration failed (e.g. a mistake in profiles.yaml) */
	error: string | null;
}

const isResticImage = (image: string) => parseImageRef(image).repository === REPOSITORY;

/** A project of this template: resticprofile image and a profiles.yaml in `conf/`. */
function isResticProject(project: ProjectInfo) {
	return project.template === 'restic' && existsSync(path.join(project.dir, CONF_DIR, MAIN_FILE));
}

/** Backup settings of a project, `null` = not backed up. */
function projectSettings(project: ProjectInfo) {
	return readRestic(getSection(project.config, 'restic'));
}

function projectHooks(project: ProjectInfo) {
	return readHooks(getSection(project.config, HOOKS_SECTION));
}

let cache: { at: number; promise: Promise<ResticInfo> } | undefined;

function invalidateRestic() {
	cache = undefined;
}

export function getRestic(projects?: ProjectInfo[]): Promise<ResticInfo> {
	if (!projects && cache && Date.now() - cache.at < 3000) return cache.promise;
	const promise = detect(projects);
	cache = { at: Date.now(), promise };
	promise.catch(() => (cache = undefined));
	return promise;
}

async function detect(projects?: ProjectInfo[]): Promise<ResticInfo> {
	const [containers, list] = await Promise.all([
		listContainers().catch(() => [] as Container[]),
		projects ?? listProjects()
	]);
	const own = list.find(isResticProject);
	if (!own) return { state: 'missing', container: null, project: null, dir: null, error: null };
	const candidates = containersOf(own, containers).filter((c) => isResticImage(c.image));
	const container = candidates.find((c) => c.state === 'running') ?? candidates[0];
	return {
		state: container?.state === 'running' ? 'ready' : 'stopped',
		container: container
			? { id: container.id, name: container.name, state: container.state }
			: null,
		project: own.name,
		dir: own.dir,
		error: lastError
	};
}

/** The running restic container, throws otherwise. */
async function readyContainer() {
	const restic = await getRestic();
	if (restic.state === 'missing') throw new Error('There is no restic project.');
	if (restic.state !== 'ready' || !restic.container) {
		throw new Error(`Restic is not running — deploy the ${restic.project} project.`);
	}
	return restic.container.id;
}

/** `docker exec` arguments for a resticprofile command in the restic container. */
const resticprofile = (
	container: string,
	profile: string,
	args: string[],
	flags = ['--lock-wait', '1h']
) => ['exec', container, 'resticprofile', '--no-ansi', ...flags, '-n', profile, ...args];

// ---------------------------------------------------------------------------
// volumes

/** Local volumes of every project: created by its compose project or mounted by its containers. */
async function volumesByProject(projects: ProjectInfo[]) {
	const [volumes, containers] = await Promise.all([
		listVolumes().catch(() => [] as Volume[]),
		listContainers().catch(() => [] as Container[])
	]);
	const details: ContainerDetails[] = await inspectContainers(containers.map((c) => c.id)).catch(
		() => []
	);
	const local = new Set(volumes.filter((v) => v.driver === 'local').map((v) => v.name));
	const result = new Map<string, string[]>();
	for (const project of projects) {
		const own = new Set(containersOf(project, containers).map((c) => c.id));
		const names = new Set([
			...volumes
				.filter((v) => v.labels['com.docker.compose.project'] === project.composeName)
				.map((v) => v.name),
			...details.filter((d) => own.has(d.id)).flatMap((d) => d.volumes)
		]);
		result.set(project.name, [...names].filter((n) => local.has(n)).sort());
	}
	return result;
}

async function projectVolumes(project: ProjectInfo) {
	return (await volumesByProject([project])).get(project.name) ?? [];
}

// ---------------------------------------------------------------------------
// applying the settings

let applied: string | null = null;
let lastError: string | null = null;

/** Manual changes in `conf/` (Files tab, ssh, …) are applied right away. */
let watcher: { dir: string; fsw: FSWatcher } | null = null;
let watchTimer: NodeJS.Timeout | undefined;

function watchConf(dir: string) {
	if (watcher?.dir === dir) return;
	watcher?.fsw.close();
	watcher = null;
	try {
		const fsw = watch(dir, (_event, file) => {
			// our own writes of the generated files
			if (file === DOCKIT_FILE) return;
			clearTimeout(watchTimer);
			watchTimer = setTimeout(() => void resticTemplate.sync?.(), 500);
		});
		fsw.on('error', () => {
			fsw.close();
			if (watcher?.fsw === fsw) watcher = null;
		});
		watcher = { dir, fsw };
	} catch {
		/* the folder is created with the next sync */
	}
}

/** compose files edited outside of Dockit, volumes created by a deploy, … */
let interval: NodeJS.Timeout | undefined;
function startInterval() {
	interval ??= setInterval(() => void resticTemplate.sync?.(), 60_000);
	interval.unref?.();
}

// dev: a reloaded module must not keep syncing with the old code next to the new one
import.meta.hot?.dispose(() => {
	clearInterval(interval);
	clearTimeout(watchTimer);
	watcher?.fsw.close();
});

async function writeIfChanged(file: string, content: string) {
	const old = await readFile(file, 'utf8').catch(() => null);
	if (old === content) return;
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, content);
}

interface ProjectState {
	project: ProjectInfo;
	settings: ResticSettings | null;
	hooks: Hooks;
}

function projectStates(projects: ProjectInfo[]): ProjectState[] {
	return projects.map((project) => ({
		project,
		settings: projectSettings(project),
		hooks: projectHooks(project)
	}));
}

async function profileSources(states: ProjectState[], resticProject: string) {
	const candidates = states.flatMap(({ project, settings, hooks }) =>
		settings && project.name !== resticProject ? [{ project, settings, hooks }] : []
	);
	if (candidates.length === 0) return [];
	const volumes = await volumesByProject(candidates.map((c) => c.project));
	return candidates.map(({ project, settings, hooks }): ProfileSource => ({
		project: project.name,
		dir: project.dir,
		volumes: volumes.get(project.name) ?? [],
		settings,
		hooks
	}));
}

/** Writes `conf/dockit.yaml` and schedules again when the config changed. Returns an error. */
async function doSync(): Promise<string | null> {
	const projects = await listProjects();
	const restic = await getRestic(projects);
	const dir = restic.dir;
	if (!dir || !restic.project) return null;
	const profiles = dockitProfiles(await profileSources(projectStates(projects), restic.project));
	await writeIfChanged(path.join(dir, CONF_DIR, DOCKIT_FILE), profiles);
	watchConf(path.join(dir, CONF_DIR));
	startInterval();
	if (restic.state !== 'ready' || !restic.container) return null;

	const main = await readFile(path.join(dir, CONF_DIR, MAIN_FILE), 'utf8').catch(() => '');
	const state = `${restic.container.id}\n${main}\n${profiles}`;
	if (state === applied) return lastError;
	const container = restic.container.id;
	const schedule = () =>
		run('docker', ['exec', container, 'sh', '-c', SCHEDULE_ALL], { timeout: 60_000 });
	let res = await schedule();
	if (res.code !== 0) {
		// e.g. a just (re)started container schedules at the same time and both write the crontab
		await new Promise((r) => setTimeout(r, 3000));
		res = await schedule();
	}
	// remembered, so the same broken config isn't retried every minute
	applied = state;
	if (res.code !== 0) {
		lastError = `resticprofile could not schedule the backups:\n${(res.stderr || res.stdout).trim()}`;
		invalidateRestic();
		return lastError;
	}
	if (lastError) invalidateRestic();
	lastError = null;
	return null;
}

let chain: Promise<unknown> = Promise.resolve();
let pending: Promise<string | null> | null = null;

/** Applies the backup settings of all projects. Calls during a running sync are coalesced into one. */
function syncRestic(): Promise<string | null> {
	if (pending) return pending;
	const next = chain.then(() => {
		pending = null;
		return doSync();
	});
	pending = next;
	chain = next.catch(() => {});
	return next;
}

// ---------------------------------------------------------------------------
// the restic project

async function dockerRootDir() {
	const res = await runOk('docker', ['info', '--format', '{{.DockerRootDir}}'], {
		timeout: 30_000
	});
	const dir = res.stdout.trim();
	if (!dir.startsWith('/')) throw new Error('Could not read the docker root directory');
	return dir;
}

function resticCompose(projectsRoot: string, dockerRoot: string, repository: string) {
	const repo = localRepository(repository);
	return `services:
  restic:
    image: ${RESTIC_IMAGE}
    restart: unless-stopped
    # restic finds the previous snapshot of a project by host name and paths
    hostname: dockit
    entrypoint: ["/bin/sh", "-c"]
    command: ["${SCHEDULE_ALL}; exec crond -f"]
    depends_on:
      docker-cli:
        condition: service_completed_successfully
    env_file:
      - path: .env
        required: false
    volumes:
      # profiles.yaml (yours), dockit.yaml (generated from the backup settings of all projects) and the password
      - ./${CONF_DIR}:${CONFIG_DIR}
      # project folders and docker volumes, read for backups and written by restores
      - ${projectsRoot}:${projectsRoot}
      - ${dockerRoot}/volumes:${VOLUMES_DIR}${repo ? `\n      # the repository\n      - ${repo}:${repo}` : ''}
      - cache:/root/.cache/restic
      # the backup hooks run commands in the services with docker exec
      - \${DOCKER_SOCKET:-/var/run/docker.sock}:/var/run/docker.sock
      - docker-cli:/usr/local/bin:ro

  # copies the docker CLI into the docker-cli volume, then exits
  docker-cli:
    image: ${DOCKER_CLI_IMAGE}
    entrypoint: ["cp", "/usr/local/bin/docker", "/cli/docker"]
    volumes:
      - docker-cli:/cli

volumes:
  cache:
  docker-cli:
`;
}

function envFile(socket: string, rest?: { user: string; password: string }) {
	const credentials = rest
		? `# Credentials of the REST server
RESTIC_REST_USERNAME=${envValue(rest.user)}
RESTIC_REST_PASSWORD=${envValue(rest.password)}
`
		: `# Credentials of remote repositories, see
# https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
# B2_ACCOUNT_ID=
# B2_ACCOUNT_KEY=
# RESTIC_REST_USERNAME=
# RESTIC_REST_PASSWORD=
`;
	return `# Timezone of the backup schedules
TZ=${process.env.TZ || 'Etc/UTC'}

# Docker socket on this host, for the backup hooks (rootless: /run/user/<uid>/docker.sock)
DOCKER_SOCKET=${envValue(socket)}

${credentials}`;
}

const keep = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1000));

const resticTemplate: ServerTemplate<ResticValues> = {
	id: 'restic',
	schema: v.pipe(
		v.object({
			repository: v.optional(v.pipe(v.string(), v.trim()), ''),
			restUser: v.optional(v.pipe(v.string(), v.trim()), ''),
			restPassword: v.optional(v.string(), ''),
			password: v.pipe(v.string(), v.trim(), v.nonEmpty('Enter a repository password')),
			keepDaily: keep,
			keepWeekly: keep,
			keepMonthly: keep,
			appendOnly: v.optional(v.boolean(), false)
		}),
		v.check(
			(values) => !repositoryProblem(values),
			(issue) => repositoryProblem(issue.input)!
		)
	),
	async unavailable() {
		const restic = await getRestic();
		return restic.project ? `Restic already runs in project ${restic.project}` : null;
	},
	async create(values) {
		const {
			repository,
			restUser,
			restPassword,
			password,
			keepDaily,
			keepWeekly,
			keepMonthly,
			appendOnly
		} = values;
		const rest = parseRepository(repository)?.backend === 'rest';
		const repo = localRepository(repository);
		if (repo && (repo === '/' || repo === getRoot() || getRoot().startsWith(`${repo}/`))) {
			error(400, 'The repository must not contain the projects folder');
		}
		return {
			compose: resticCompose(getRoot(), await dockerRootDir(), repository),
			config: {
				description: 'Incremental backups with restic. Backups are configured in each project.'
			},
			env: envFile(
				await hostDockerSocket(),
				rest && (restUser || restPassword) ? { user: restUser, password: restPassword } : undefined
			),
			files: {
				[`${CONF_DIR}/${MAIN_FILE}`]: mainProfiles(
					repository,
					appendOnly ? null : { keepDaily, keepWeekly, keepMonthly }
				),
				[`${CONF_DIR}/${DOCKIT_FILE}`]: dockitProfiles([]),
				[`${CONF_DIR}/${PASSWORD_FILE}`]: `${password}\n`
			}
		};
	},
	async afterCreate() {
		invalidateRestic();
		await syncRestic();
	},
	async tabs(project) {
		const restic = await getRestic();
		if (!restic.project || restic.project === project.name) return [];
		return [{ id: 'backups' }];
	},
	async beforeAction(project, action, ctx) {
		if (action !== 'update') return;
		const settings = projectSettings(project);
		if (!settings?.beforeUpdate) return;
		const restic = await getRestic();
		if (restic.state === 'missing' || restic.project === project.name) return;
		ctx.log('Backing up before the update\n');
		await runBackup(project, ctx, settings);
		ctx.log('\n');
	},
	async sync() {
		const problem = await syncRestic();
		if (problem) console.error(`[dockit] ${problem}`);
	},
	matches: (services) => services.some((s) => !!s.image && isResticImage(s.image))
};

export default resticTemplate;

// ---------------------------------------------------------------------------
// backups of a project

export async function readProjectBackup(name: string) {
	const project = await loadProject(name);
	const [restic, volumes] = await Promise.all([getRestic(), projectVolumes(project)]);
	const hooks = projectHooks(project);
	return {
		restic,
		settings: projectSettings(project),
		parseError: project.parseError,
		volumes,
		dir: project.dir,
		isSelf: project.isSelf,
		hooks: {
			sets: hooks,
			candidates: project.compose ? hookCandidates(project.compose, hooks) : []
		}
	};
}

/** Writes the edited hooks (and settings). An error of the edit is returned, not thrown. */
async function editHooks(
	name: string,
	edit: (
		hooks: Hooks,
		project: ProjectInfo,
		settings: ResticSettings | null
	) => { hooks: Hooks; settings?: ResticSettings | null }
) {
	const project = await loadProject(name);
	const sources = await readSources(project);
	const restic = await getRestic();
	if (restic.project === name) {
		return { changed: false, error: 'The restic project itself is not backed up.' };
	}
	let next: ReturnType<typeof edit>;
	try {
		next = edit(
			readHooks(getSection(sources.config, HOOKS_SECTION)),
			project,
			readRestic(getSection(sources.config, 'restic'))
		);
	} catch (e) {
		return { changed: false, error: e instanceof Error ? e.message : String(e) };
	}
	let config = setSection(sources.config, HOOKS_SECTION, hooksSection(next.hooks));
	if (next.settings !== undefined)
		config = setSection(config, 'restic', resticSection(next.settings));
	if (JSON.stringify(config) === JSON.stringify(sources.config))
		return { changed: false, error: null };
	await saveSources(project, sources, { config });
	return { changed: true, error: await syncRestic() };
}

/**
 * Adds the hooks of a preset for a service. The raw files of a database are
 * not needed in the backup anymore: its volumes are excluded.
 */
export function addProjectHooks(name: string, service: string, preset: Preset) {
	return editHooks(name, (hooks, project, settings) => {
		if (!project.compose) throw new Error(project.parseError ?? 'The compose file is invalid');
		const added = addHooks(project.compose, hooks, service, project.composeName, preset);
		if (!settings || !added.volumes.length) return { hooks: added.hooks };
		const excludeVolumes = [...new Set([...settings.excludeVolumes, ...added.volumes])].sort();
		return { hooks: added.hooks, settings: { ...settings, excludeVolumes } };
	});
}

/** Replaces the scripts of a set of hooks. */
export function saveProjectHooks(name: string, set: string, scripts: HookSet) {
	return editHooks(name, (hooks) => {
		if (!(set in hooks)) throw new Error(`There are no hooks for ${set}`);
		return { hooks: { ...hooks, [set]: scripts } };
	});
}

/** Removes a set of hooks. */
export function removeProjectHooks(name: string, set: string) {
	return editHooks(name, (hooks) => {
		if (!(set in hooks)) throw new Error(`There are no hooks for ${set}`);
		return { hooks: Object.fromEntries(Object.entries(hooks).filter(([n]) => n !== set)) };
	});
}

export async function saveProjectBackup(name: string, settings: ResticSettings | null) {
	const project = await loadProject(name);
	const sources = await readSources(project);
	const restic = await getRestic();
	if (restic.project === name) return 'The restic project itself is not backed up.';
	const config = setSection(sources.config, 'restic', resticSection(settings));
	if (JSON.stringify(config) === JSON.stringify(sources.config)) return null;
	await saveSources(project, sources, { config });
	return syncRestic();
}

/** "No repository yet" is not an error: nothing was backed up so far. */
const NO_REPOSITORY =
	/repository does not exist|Is there a repository at the following location|config file does not exist/i;

const SNAPSHOTS_TIMEOUT = 30_000;

export async function listSnapshots(name: string): Promise<Snapshot[]> {
	const container = await readyContainer();
	const args = resticprofile(
		container,
		'default',
		['snapshots', '--json', '--tag', projectTag(name)],
		['-q']
	);
	const start = Date.now();
	try {
		const res = await runOk('docker', args, { timeout: SNAPSHOTS_TIMEOUT });
		return parseSnapshots(res.stdout);
	} catch (e) {
		if (e instanceof CommandError && NO_REPOSITORY.test(`${e.result.stdout}\n${e.result.stderr}`)) {
			return [];
		}
		// restic retries an unreachable repository for minutes without any output
		if (Date.now() - start >= SNAPSHOTS_TIMEOUT) {
			throw new Error(
				`The repository did not answer within ${SNAPSHOTS_TIMEOUT / 1000} s. Is it reachable from the restic container?`,
				{ cause: e }
			);
		}
		throw e;
	}
}

async function runBackup(project: ProjectInfo, ctx: JobContext, settings: ResticSettings | null) {
	const container = await readyContainer();
	if (!settings) throw new Error(`Backups of ${project.name} are disabled`);
	// the profile has to know the latest settings and volumes
	const problem = await syncRestic();
	if (problem) throw new Error(problem);
	await ctx.exec('docker', resticprofile(container, profileName(project.name), ['backup']));
}

export async function backupProject(name: string, user: string | null) {
	const project = await loadProject(name);
	return startJob(project.name, 'Backup', user, async (ctx) => {
		try {
			await runBackup(project, ctx, projectSettings(project));
			ctx.log('\n\x1b[32m✔ Backup finished\x1b[0m\n');
			await logActivity({
				project: project.name,
				type: 'backup',
				level: 'success',
				message: `Backup${user ? ` by ${user}` : ''}`
			});
		} catch (e) {
			await notifyJobFailed(ctx, 'action_failed', 'Backup', e);
			throw e;
		}
	});
}

interface RestoreOptions {
	snapshot: string;
	files: boolean;
	volumes: string[];
	/** remove files that are not in the snapshot */
	delete: boolean;
}

export async function restoreProject(name: string, options: RestoreOptions, user: string | null) {
	const project = await loadProject(name);
	if (project.isSelf) error(400, 'Dockit cannot restore its own project. Use restic directly.');
	if (!project.composeFile) error(400, 'Project has no compose file');
	if (!options.files && options.volumes.length === 0) error(400, 'Nothing selected to restore');
	const container = await readyContainer().catch((e) => error(400, e.message));
	const [snapshots, containers] = await Promise.all([listSnapshots(name), listContainers()]);
	const snapshot = snapshots.find(
		(s) => s.id === options.snapshot || s.shortId === options.snapshot
	);
	if (!snapshot) error(404, 'Snapshot not found');
	const volumePaths = options.volumes.map(volumePath);
	const paths = options.files ? [project.dir, ...volumePaths] : volumePaths;
	const missing = paths.find((p) => !snapshot.paths.includes(p));
	if (missing) error(400, `The snapshot does not contain ${missing}`);

	const running = containersOf(project, containers).some((c) => c.state === 'running');
	const job = startJob(project.name, `Restore ${snapshot.shortId}`, user, async (ctx) => {
		const dc = (args: string[]) => ctx.exec('docker', ['compose', ...args], { cwd: project.dir });
		/** Runs the scripts of a phase in the restic container, fails when one of them failed. */
		const runHooks = async (phase: Phase, hooks: Hooks) => {
			const failed: string[] = [];
			for (const { name: set, script } of phaseScripts(hooks, phase)) {
				const command = hookCommand(project.dir, phase, set, script);
				await ctx.exec('docker', ['exec', container, 'sh', '-c', command]).catch(() => {
					failed.push(set);
				});
			}
			if (failed.length) throw new Error(`The ${phase} hooks of ${failed.join(', ')} failed`);
		};
		let hooks = projectHooks(project);
		// the hooks restore their dumps, which are part of the project files
		let withHooks = options.files && Object.keys(hooks).length > 0;
		if (Object.keys(hooks).length && !options.files) {
			ctx.log('The backup hooks are skipped: their dumps are part of the project files.\n');
		}
		try {
			if (withHooks && running) await runHooks('pre-restore', hooks);
			await dc(['down']);
			const restore = (p: string, exclude: string[] = []) =>
				ctx.exec(
					'docker',
					resticprofile(container, 'default', [
						'restore',
						`${snapshot.id}:${p}`,
						'--target',
						p,
						...(options.delete ? ['--delete'] : []),
						...exclude.flatMap((e) => ['--exclude', e])
					])
				);
			// the files first: the restored compose file decides which volumes exist
			if (options.files) {
				// inside the restored folder `/` is the project folder, like in the settings:
				// excluded files are neither restored nor deleted
				await restore(project.dir, projectSettings(project)?.exclude ?? []);
			}
			if (options.volumes.length) {
				// creates missing volumes (with the compose labels) without starting anything
				await dc(['up', '--no-start']);
				for (const volume of options.volumes) await restore(volumePath(volume));
			}
			if (options.files) {
				// the restored dockit.json and compose file decide which hooks there are
				const restored = await loadProject(name);
				hooks = projectHooks(restored);
				withHooks = Object.keys(hooks).length > 0;
				if (phaseScripts(hooks, 'post-restore').length) {
					// only the services with hooks and what they depend on: an app must not
					// run against the database before its dump is restored
					const services = hookedServices(restored.compose, hooks);
					if (services.length) {
						ctx.log(`\nStarting ${services.join(', ')} for the post-restore hooks\n`);
						await dc(['up', '-d', ...services]);
					}
					await runHooks('post-restore', hooks);
					if (!running) await dc(['down']);
				}
			}
			ctx.log('\n\x1b[32m✔ Restore finished\x1b[0m\n');
			await logActivity({
				project: project.name,
				type: 'restore',
				level: 'success',
				message: `Restored snapshot ${snapshot.shortId}${user ? ` by ${user}` : ''}`
			});
		} catch (e) {
			if (withHooks) await runHooks('restore-failed', hooks).catch(() => {});
			await notifyJobFailed(ctx, 'action_failed', 'Restore', e);
			throw e;
		}
	});
	// it was running before: start it again once the restore succeeded
	if (running) {
		void waitForJob(job).then(async (done) => {
			if (done.status === 'success') await runProjectAction(name, 'up', user).catch(() => {});
		});
	}
	return job;
}
