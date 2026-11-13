import { existsSync } from 'node:fs';
import { containersOf } from './actions';
import { listContainers, type Container } from './docker';
import { isProjectBusy } from './jobs';
import { getRoot, listProjects, loadProject, type ProjectInfo } from './projects';
import { getUpdateChecks } from './updates';
import { resolveServices } from './compose';
import type { UpdateCheck } from './db/schema';
import { domainUrl } from '#lib/proxy.js';

export type ProjectState = 'running' | 'partial' | 'stopped' | 'unhealthy' | 'not-deployed';

export interface ProjectSummary {
	name: string;
	dir: string;
	composeName: string;
	isSelf: boolean;
	description: string | null;
	url: string | null;
	domains: string[];
	/** url to open: the configured url or the first proxy domain */
	link: string | null;
	autoUpdate: boolean;
	parseError: string | null;
	serviceCount: number;
	state: ProjectState;
	running: number;
	total: number;
	updates: number;
	busy: boolean;
}

function stateOf(containers: Container[]): ProjectState {
	if (containers.length === 0) return 'not-deployed';
	const running = containers.filter((c) => c.state === 'running');
	if (
		running.some((c) => c.health === 'unhealthy') ||
		containers.some((c) => c.state === 'restarting')
	)
		return 'unhealthy';
	if (running.length === containers.length) return 'running';
	if (running.length === 0) return 'stopped';
	return 'partial';
}

function summarize(p: ProjectInfo, containers: Container[], checks: UpdateCheck[]): ProjectSummary {
	const own = containersOf(p, containers);
	return {
		name: p.name,
		dir: p.dir,
		composeName: p.composeName,
		isSelf: p.isSelf,
		description: p.meta.description ?? null,
		url: p.meta.url ?? null,
		domains: p.domains,
		link: p.meta.url ?? (p.domains[0] ? domainUrl(p.domains[0]) : null),
		autoUpdate: p.meta.autoUpdate ?? false,
		parseError: p.parseError,
		serviceCount: p.services.length,
		state: stateOf(own),
		running: own.filter((c) => c.state === 'running').length,
		total: own.length,
		updates: checks.filter(
			(c) => c.project === p.name && c.status === 'available' && !!c.localDigest
		).length,
		busy: isProjectBusy(p.name)
	};
}

export async function getOverview() {
	const root = getRoot();
	const [projects, containers, checks] = await Promise.all([
		listProjects(),
		listContainers().catch(() => [] as Container[]),
		getUpdateChecks()
	]);
	return {
		root,
		rootExists: existsSync(root),
		projects: projects.map((p) => summarize(p, containers, checks))
	};
}

export async function getProjectStatus(name: string) {
	const project = await loadProject(name);
	const [containers, checks, resolved] = await Promise.all([
		listContainers(),
		getUpdateChecks(name),
		resolveServices(project).catch(() => [])
	]);
	const own = containersOf(project, containers);
	const services = project.services.map((s) => {
		const cs = own.filter((c) => c.service === s.name);
		const image = resolved.find((r) => r.name === s.name)?.image ?? s.image;
		return { ...s, image, containers: cs };
	});
	// containers of services that were removed from the compose file
	const orphans = own.filter((c) => !project.services.some((s) => s.name === c.service));
	return {
		summary: summarize(project, containers, checks),
		services,
		orphans,
		updates: checks
	};
}
