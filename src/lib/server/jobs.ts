import { EventEmitter } from 'node:events';
import { run, type RunOptions } from './exec';
import { invalidateContainers } from './docker';

export type JobStatus = 'queued' | 'running' | 'success' | 'failed';

export interface Job {
	id: string;
	project: string;
	action: string;
	status: JobStatus;
	output: string;
	startedAt: Date;
	finishedAt: Date | null;
	error: string | null;
	user: string | null;
}

export type JobSummary = Omit<Job, 'output'>;

const MAX_OUTPUT = 200_000;
const jobs = new Map<string, Job>();
const projectQueues = new Map<string, Promise<unknown>>();
export const jobEvents = new EventEmitter();
jobEvents.setMaxListeners(0);

export interface JobContext {
	log: (text: string) => void;
	/** runs a command, streams its output into the job log, throws on failure */
	exec: (cmd: string, args: string[], opts?: RunOptions) => Promise<string>;
	job: Job;
}

function emit(job: Job) {
	jobEvents.emit('change', job);
	jobEvents.emit(`job:${job.id}`, job);
}

/**
 * Jobs for the same project run one after another, different projects in
 * parallel. The returned job can be followed via `jobEvents`.
 */
export function startJob(
	project: string,
	action: string,
	user: string | null,
	fn: (ctx: JobContext) => Promise<void>
): Job {
	const job: Job = {
		id: crypto.randomUUID(),
		project,
		action,
		status: 'queued',
		output: '',
		startedAt: new Date(),
		finishedAt: null,
		error: null,
		user
	};
	jobs.set(job.id, job);
	trim();

	const log = (text: string) => {
		job.output += text;
		if (job.output.length > MAX_OUTPUT) job.output = job.output.slice(-MAX_OUTPUT);
		emit(job);
	};

	const ctx: JobContext = {
		job,
		log,
		async exec(cmd, args, opts = {}) {
			log(`\x1b[2m$ ${cmd} ${args.join(' ')}\x1b[0m\n`);
			const res = await run(cmd, args, {
				...opts,
				onOutput: (chunk) => log(chunk)
			});
			if (res.code !== 0) {
				throw new Error(`${cmd} ${args.slice(0, 2).join(' ')} failed with exit code ${res.code}`);
			}
			return res.stdout;
		}
	};

	const previous = projectQueues.get(project) ?? Promise.resolve();
	const next = previous
		.catch(() => {})
		.then(async () => {
			job.status = 'running';
			job.startedAt = new Date();
			emit(job);
			try {
				await fn(ctx);
				job.status = 'success';
			} catch (e) {
				job.status = 'failed';
				job.error = e instanceof Error ? e.message : String(e);
				log(`\n\x1b[31m✖ ${job.error}\x1b[0m\n`);
			} finally {
				job.finishedAt = new Date();
				invalidateContainers();
				emit(job);
				if (projectQueues.get(project) === next) projectQueues.delete(project);
			}
		});
	projectQueues.set(project, next);
	emit(job);
	return job;
}

/** Waits until a job is finished. */
export function waitForJob(job: Job): Promise<Job> {
	if (job.finishedAt) return Promise.resolve(job);
	return new Promise((resolve) => {
		const listener = (j: Job) => {
			if (j.finishedAt) {
				jobEvents.off(`job:${job.id}`, listener);
				resolve(j);
			}
		};
		jobEvents.on(`job:${job.id}`, listener);
	});
}

export function getJob(id: string) {
	return jobs.get(id) ?? null;
}

export function listJobs(): JobSummary[] {
	return (
		[...jobs.values()]
			.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			.map(({ output, ...rest }) => rest)
	);
}

export function isProjectBusy(project: string) {
	return [...jobs.values()].some(
		(j) => j.project === project && (j.status === 'running' || j.status === 'queued')
	);
}

function trim() {
	const finished = [...jobs.values()]
		.filter((j) => j.finishedAt)
		.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
	while (jobs.size > 100 && finished.length) jobs.delete(finished.shift()!.id);
}
