import { createReadStream, createWriteStream } from 'node:fs';
import {
	lstat,
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	writeFile
} from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { COMPOSE_FILES, loadProject } from './projects';

/** files above this size are not opened in the editor */
export const MAX_EDIT_SIZE = 2 * 1024 * 1024;

export interface FileEntry {
	name: string;
	/** path relative to the project folder, always with `/` */
	path: string;
	type: 'dir' | 'file' | 'symlink' | 'other';
	size: number;
	modified: number;
	/** compose file / .env: managed in the Configuration tab */
	managed: boolean;
}

/** Normalizes a user supplied relative path ('' is the project root). */
export function cleanPath(rel: string) {
	const parts = rel.split(/[/\\]+/).filter((p) => p && p !== '.');
	if (parts.some((p) => p === '..' || p.includes('\0'))) error(400, 'Invalid path');
	return parts.join('/');
}

/**
 * Resolves `rel` inside the project folder. Symlinks are followed for the parent folder
 * and the target must still be inside the project, so links cannot escape it.
 */
async function resolve(name: string, rel: string, followLeaf = true) {
	const project = await loadProject(name);
	const clean = cleanPath(rel);
	const root = await realpath(project.dir);
	const abs = path.join(root, clean);
	// the nearest existing ancestor (or the path itself) must resolve into the project
	const parts = clean ? clean.split('/') : [];
	// (followLeaf = false: a symlink itself can be renamed/removed even if it points outside)
	for (let i = followLeaf ? parts.length : parts.length - 1; i >= 0; i--) {
		const real = await realpath(path.join(root, ...parts.slice(0, i))).catch(() => null);
		if (real === null) continue;
		if (!inside(root, real)) error(403, 'Path is outside of the project folder');
		break;
	}
	return { project, root, clean, abs };
}

const inside = (root: string, p: string) => p === root || p.startsWith(root + path.sep);

/** Compose file and .env in the project root are edited in the Configuration tab only. */
function isManaged(clean: string, composeFile: string | null) {
	return (
		clean === '.env' || clean === composeFile || (!composeFile && COMPOSE_FILES.includes(clean))
	);
}

function protect(clean: string, composeFile: string | null) {
	if (!clean) error(400, 'The project folder itself cannot be changed');
	if (isManaged(clean, composeFile)) {
		error(400, `${clean} is managed in the Configuration tab`);
	}
}

/** Turns fs errors into readable http errors. */
async function fs<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (e) {
		const code = (e as NodeJS.ErrnoException)?.code;
		if (code === 'ENOENT') error(404, 'File or folder not found');
		if (code === 'EEXIST') error(409, 'A file or folder with this name already exists');
		if (code === 'EACCES' || code === 'EPERM') error(403, 'Permission denied');
		if (code === 'ENOTDIR') error(400, 'Not a folder');
		if (code === 'EISDIR') error(400, 'This is a folder');
		if (code === 'ENOTEMPTY') error(409, 'Folder is not empty');
		throw e;
	}
}

const exists = (p: string) =>
	lstat(p).then(
		() => true,
		() => false
	);

export async function listDir(name: string, rel: string): Promise<FileEntry[]> {
	const { project, clean, abs } = await resolve(name, rel);
	const entries = await fs(() => readdir(abs, { withFileTypes: true }));
	const list = await Promise.all(
		entries.map(async (e): Promise<FileEntry> => {
			const p = clean ? `${clean}/${e.name}` : e.name;
			const s = await stat(path.join(abs, e.name)).catch(() => null);
			const type = e.isSymbolicLink()
				? s?.isDirectory()
					? 'dir'
					: 'symlink'
				: e.isDirectory()
					? 'dir'
					: e.isFile()
						? 'file'
						: 'other';
			return {
				name: e.name,
				path: p,
				type,
				size: s && !s.isDirectory() ? s.size : 0,
				modified: s?.mtimeMs ?? 0,
				managed: isManaged(p, project.composeFile)
			};
		})
	);
	return list.sort(
		(a, b) => Number(b.type === 'dir') - Number(a.type === 'dir') || a.name.localeCompare(b.name)
	);
}

export async function readText(name: string, rel: string) {
	const { project, clean, abs } = await resolve(name, rel);
	if (clean === '.env') error(400, '.env is managed in the Configuration tab');
	const s = await fs(() => stat(abs));
	if (!s.isFile()) error(400, 'Not a file');
	const base = { path: clean, size: s.size, modified: s.mtimeMs };
	if (s.size > MAX_EDIT_SIZE) return { ...base, content: null, reason: 'too-large' as const };
	const buf = await fs(() => readFile(abs));
	// NUL bytes or invalid utf-8 → binary
	const content = buf.toString('utf8');
	if (buf.includes(0) || content.includes('�')) {
		return { ...base, content: null, reason: 'binary' as const };
	}
	return {
		...base,
		content,
		reason: null,
		managed: isManaged(clean, project.composeFile)
	};
}

export async function writeText(
	name: string,
	rel: string,
	content: string,
	opts: { create?: boolean; expectedModified?: number } = {}
) {
	const { project, clean, abs } = await resolve(name, rel);
	protect(clean, project.composeFile);
	if (opts.create) {
		await fs(() => mkdir(path.dirname(abs), { recursive: true }));
		await fs(() => writeFile(abs, content, { flag: 'wx' }));
	} else {
		const s = await fs(() => stat(abs));
		if (!s.isFile()) error(400, 'Not a file');
		if (opts.expectedModified && Math.abs(s.mtimeMs - opts.expectedModified) > 1) {
			error(409, 'The file was changed on the server in the meantime. Reload it first.');
		}
		await fs(() => writeFile(abs, content));
	}
	return (await stat(abs)).mtimeMs;
}

export async function makeDir(name: string, rel: string) {
	const { project, clean, abs } = await resolve(name, rel);
	protect(clean, project.composeFile);
	if (await exists(abs)) error(409, 'A file or folder with this name already exists');
	await fs(() => mkdir(abs, { recursive: true }));
}

export async function movePath(name: string, from: string, to: string) {
	const src = await resolve(name, from, false);
	const dst = await resolve(name, to, false);
	protect(src.clean, src.project.composeFile);
	protect(dst.clean, dst.project.composeFile);
	if (dst.clean.startsWith(src.clean + '/')) error(400, 'A folder cannot be moved into itself');
	if (await exists(dst.abs)) error(409, 'A file or folder with this name already exists');
	await fs(() => mkdir(path.dirname(dst.abs), { recursive: true }));
	await fs(() => rename(src.abs, dst.abs));
}

export async function removePath(name: string, rel: string) {
	const { project, clean, abs } = await resolve(name, rel, false);
	protect(clean, project.composeFile);
	// lstat: a symlink is removed itself, not its target
	await fs(() => lstat(abs));
	await fs(() => rm(abs, { recursive: true }));
}

/** Streams an upload into the project folder. */
export async function uploadFile(
	name: string,
	rel: string,
	body: ReadableStream<Uint8Array>,
	overwrite: boolean
) {
	const { project, clean, abs } = await resolve(name, rel);
	protect(clean, project.composeFile);
	const existing = await lstat(abs).catch(() => null);
	if (existing && !overwrite) error(409, `${clean} already exists`);
	if (existing && !existing.isFile()) error(409, `${clean} exists and is not a file`);
	await fs(() => mkdir(path.dirname(abs), { recursive: true }));
	// write next to the target first, so a failed upload does not destroy the old file
	const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.dockit-upload-${Date.now()}`);
	try {
		await fs(() =>
			pipeline(
				Readable.fromWeb(body as import('node:stream/web').ReadableStream),
				createWriteStream(tmp)
			)
		);
		await fs(() => rename(tmp, abs));
	} catch (e) {
		await rm(tmp, { force: true });
		throw e;
	}
	return clean;
}

export async function downloadFile(name: string, rel: string) {
	const { clean, abs } = await resolve(name, rel);
	if (clean === '.env') error(400, '.env is managed in the Configuration tab');
	const s = await fs(() => stat(abs));
	if (!s.isFile()) error(400, 'Not a file');
	return {
		name: path.basename(abs),
		size: s.size,
		stream: Readable.toWeb(createReadStream(abs)) as ReadableStream<Uint8Array>
	};
}
