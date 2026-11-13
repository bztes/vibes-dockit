import os from 'node:os';
import { statfsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { getRoot } from './projects.js';
import { listContainers } from './docker.js';
import { parseLines, runOk } from './exec.js';

// /proc/loadavg, /proc/stat and /proc/meminfo are not namespaced, so inside the
// Dockit container these numbers describe the host.

const INTERVAL = 2_000;
const HISTORY = 60;

export interface SystemSample {
	at: number;
	/** 0–100, all cores combined */
	cpu: number;
	memUsed: number;
}

export interface Usage {
	/** share of the whole host, 0–100 (docker's own number is per core) */
	cpu: number;
	mem: number;
}

export interface SystemLoad {
	hostname: string;
	cores: number;
	uptime: number;
	load: [number, number, number];
	cpu: number;
	mem: { total: number; used: number };
	disk: { path: string; total: number; used: number } | null;
	history: SystemSample[];
	/** by compose project name, only running containers */
	projects: Record<string, Usage>;
	/** by full container id */
	containers: Record<string, Usage>;
}

const events = new EventEmitter();
events.setMaxListeners(0);

const history: SystemSample[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let prev = cpuTimes();
let latest: SystemLoad | null = null;
let docker: { projects: Record<string, Usage>; containers: Record<string, Usage> } = {
	projects: {},
	containers: {}
};

function cpuTimes() {
	let idle = 0;
	let total = 0;
	for (const c of os.cpus()) {
		const t = c.times;
		idle += t.idle;
		total += t.user + t.nice + t.sys + t.idle + t.irq;
	}
	return { idle, total };
}

function disk() {
	const root = getRoot();
	try {
		const s = statfsSync(root);
		const total = s.blocks * s.bsize;
		return { path: root, total, used: total - s.bavail * s.bsize };
	} catch {
		return null;
	}
}

function sample(): SystemLoad {
	const now = cpuTimes();
	const dTotal = now.total - prev.total;
	const cpu =
		dTotal > 0 ? Math.max(0, Math.min(100, (1 - (now.idle - prev.idle) / dTotal) * 100)) : 0;
	prev = now;

	const total = os.totalmem();
	const used = total - os.freemem();

	history.push({ at: Date.now(), cpu, memUsed: used });
	if (history.length > HISTORY) history.shift();

	const [l1, l5, l15] = os.loadavg();
	return {
		hostname: os.hostname(),
		cores: os.availableParallelism(),
		uptime: os.uptime(),
		load: [l1, l5, l15],
		cpu,
		mem: { total, used },
		disk: disk(),
		history: [...history],
		...docker
	};
}

function tick() {
	latest = sample();
	events.emit('sample', latest);
}

const UNITS: Record<string, number> = {
	B: 1,
	KB: 1e3,
	MB: 1e6,
	GB: 1e9,
	TB: 1e12,
	KIB: 1024,
	MIB: 1024 ** 2,
	GIB: 1024 ** 3,
	TIB: 1024 ** 4
};

/** "80.95MiB / 15.29GiB" → bytes of the first part */
export function parseSize(s: string) {
	const m = s.trim().match(/^([\d.]+)\s*([a-z]*)/i);
	if (!m) return 0;
	return parseFloat(m[1]) * (UNITS[m[2].toUpperCase() || 'B'] ?? 1);
}

async function dockerStats() {
	// `--no-stream` measures for ~1–2s, so this also paces the loop
	const [{ stdout }, all] = await Promise.all([
		runOk('docker', ['stats', '--no-stream', '--no-trunc', '--format', '{{json .}}'], {
			timeout: 20_000
		}),
		listContainers()
	]);
	const cores = os.availableParallelism();
	const projectOf = new Map(all.map((c) => [c.id, c.project]));
	const projects: Record<string, Usage> = {};
	const containers: Record<string, Usage> = {};
	for (const s of parseLines<{ Container: string; CPUPerc: string; MemUsage: string }>(stdout)) {
		const usage = {
			cpu: (parseFloat(s.CPUPerc) || 0) / cores,
			mem: parseSize(s.MemUsage.split('/')[0])
		};
		containers[s.Container] = usage;
		const project = projectOf.get(s.Container);
		if (!project) continue;
		const p = (projects[project] ??= { cpu: 0, mem: 0 });
		p.cpu += usage.cpu;
		p.mem += usage.mem;
	}
	return { projects, containers };
}

let statsLoop = false;

async function runStatsLoop() {
	if (statsLoop) return;
	statsLoop = true;
	while (timer) {
		const started = Date.now();
		try {
			docker = await dockerStats();
		} catch {
			docker = { projects: {}, containers: {} };
		}
		await new Promise((r) => setTimeout(r, Math.max(500, INTERVAL - (Date.now() - started))));
	}
	statsLoop = false;
}

/** samples only while someone is watching */
export function subscribeSystemLoad(fn: (s: SystemLoad) => void) {
	events.on('sample', fn);
	if (!timer) {
		prev = cpuTimes();
		history.length = 0;
		latest = null;
		docker = { projects: {}, containers: {} };
		timer = setInterval(tick, INTERVAL);
		runStatsLoop();
		// first value quickly instead of waiting a full interval
		setTimeout(tick, 250);
	} else if (latest) {
		queueMicrotask(() => fn(latest!));
	}
	return () => {
		events.off('sample', fn);
		if (events.listenerCount('sample') === 0 && timer) {
			clearInterval(timer);
			timer = null;
		}
	};
}
