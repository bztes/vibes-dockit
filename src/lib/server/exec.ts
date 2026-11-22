import { spawn } from 'node:child_process';

export interface RunResult {
	code: number;
	stdout: string;
	stderr: string;
}

export interface RunOptions {
	cwd?: string;
	input?: string;
	timeout?: number;
	env?: Record<string, string>;
	onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void;
}

/**
 * The only variables child processes get from dockit's environment: what the docker CLI needs
 * to find its plugins, credentials and daemon (plus proxies and the ssh agent for builds).
 * Everything else is dropped because docker compose prefers shell variables over a project's
 * .env, so dockit's own variables (DATA_DIR, PORT, ...) would silently override its values.
 */
const PASS_ENV = [
	'PATH',
	'HOME',
	'DOCKER_HOST',
	'DOCKER_CONTEXT',
	'DOCKER_CONFIG',
	'DOCKER_CERT_PATH',
	'DOCKER_TLS_VERIFY',
	'DOCKER_API_VERSION',
	'HTTP_PROXY',
	'HTTPS_PROXY',
	'NO_PROXY',
	'http_proxy',
	'https_proxy',
	'no_proxy',
	'SSH_AUTH_SOCK'
];

export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const key of PASS_ENV) if (process.env[key] !== undefined) env[key] = process.env[key];
	return { ...env, ...extra };
}

/** Runs a command without a shell (arguments are never interpreted). */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
	return new Promise((resolve) => {
		const child = spawn(cmd, args, {
			cwd: opts.cwd,
			env: childEnv(opts.env),
			stdio: ['pipe', 'pipe', 'pipe']
		});
		let stdout = '';
		let stderr = '';
		let timer: NodeJS.Timeout | undefined;
		if (opts.timeout) {
			timer = setTimeout(() => child.kill('SIGKILL'), opts.timeout);
		}
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (d: string) => {
			stdout += d;
			opts.onOutput?.(d, 'stdout');
		});
		child.stderr.on('data', (d: string) => {
			stderr += d;
			opts.onOutput?.(d, 'stderr');
		});
		child.on('error', (err) => {
			clearTimeout(timer);
			resolve({ code: 127, stdout, stderr: stderr + String(err.message) });
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve({ code: code ?? 1, stdout, stderr });
		});
		if (opts.input !== undefined) child.stdin.end(opts.input);
		else child.stdin.end();
	});
}

export class CommandError extends Error {
	constructor(
		message: string,
		public result: RunResult
	) {
		super(message);
	}
}

/** Like `run`, but throws when the exit code is not 0. */
export async function runOk(cmd: string, args: string[], opts: RunOptions = {}) {
	const result = await run(cmd, args, opts);
	if (result.code !== 0) {
		const msg = (result.stderr || result.stdout).trim().split('\n').slice(-5).join('\n');
		throw new CommandError(msg || `${cmd} ${args[0]} exited with ${result.code}`, result);
	}
	return result;
}

/** Parses newline delimited json output (`--format '{{json .}}'`). */
export function parseLines<T>(stdout: string): T[] {
	return stdout
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean)
		.map((l) => JSON.parse(l) as T);
}
