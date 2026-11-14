import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let base = '';

vi.mock('./projects', () => ({
	COMPOSE_FILES: ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'],
	loadProject: async (name: string) => ({
		name,
		dir: path.join(base, 'projects', name),
		composeFile: 'compose.yaml'
	})
}));

const files = await import('./files');

const status = (p: Promise<unknown>) =>
	p.then(
		() => 0,
		(e: { status?: number }) => e.status ?? -1
	);

const body = (text: string) => Readable.toWeb(Readable.from([Buffer.from(text)])) as ReadableStream;

beforeEach(async () => {
	base = await mkdtemp(path.join(tmpdir(), 'dockit-files-'));
	const dir = path.join(base, 'projects', 'app');
	await mkdir(path.join(dir, 'config'), { recursive: true });
	await writeFile(path.join(dir, 'compose.yaml'), 'services: {}\n');
	await writeFile(path.join(dir, '.env'), 'SECRET=x\n');
	await writeFile(path.join(dir, 'config', 'app.conf'), 'hello');
	await mkdir(path.join(base, 'outside'));
	await writeFile(path.join(base, 'outside', 'secret'), 'nope');
	await symlink(path.join(base, 'outside'), path.join(dir, 'escape'));
});

afterEach(() => rm(base, { recursive: true, force: true }));

describe('cleanPath', () => {
	it('normalizes and rejects traversal', () => {
		expect(files.cleanPath('/a//b/./c/')).toBe('a/b/c');
		expect(files.cleanPath('')).toBe('');
		expect(() => files.cleanPath('a/../../b')).toThrow();
		expect(() => files.cleanPath('..\\x')).toThrow();
	});
});

describe('file manager', () => {
	it('lists folders first and flags managed files', async () => {
		const list = await files.listDir('app', '');
		expect(list[0]).toMatchObject({ name: 'config', type: 'dir' });
		expect(list.find((e) => e.name === '.env')?.managed).toBe(true);
		expect(list.find((e) => e.name === 'compose.yaml')?.managed).toBe(true);
	});

	it('reads, writes and creates text files', async () => {
		const f = await files.readText('app', 'config/app.conf');
		expect(f.content).toBe('hello');
		await files.writeText('app', 'config/app.conf', 'changed', { expectedModified: f.modified });
		expect((await files.readText('app', 'config/app.conf')).content).toBe('changed');
		await files.writeText('app', 'new/deep/file.txt', 'x', { create: true });
		expect(await status(files.writeText('app', 'new/deep/file.txt', 'y', { create: true }))).toBe(
			409
		);
	});

	it('detects conflicting edits', async () => {
		expect(
			await status(files.writeText('app', 'config/app.conf', 'x', { expectedModified: 1 }))
		).toBe(409);
	});

	it('never exposes or changes .env and the compose file', async () => {
		expect(await status(files.readText('app', '.env'))).toBe(400);
		expect(await status(files.downloadFile('app', '.env'))).toBe(400);
		expect(await status(files.removePath('app', 'compose.yaml'))).toBe(400);
		expect(await status(files.movePath('app', 'config', '.env'))).toBe(400);
		expect(await status(files.uploadFile('app', '.env', body('x'), true))).toBe(400);
		expect(await status(files.removePath('app', ''))).toBe(400);
	});

	it('does not follow symlinks out of the project', async () => {
		expect(await status(files.listDir('app', 'escape'))).toBe(403);
		expect(await status(files.readText('app', 'escape/secret'))).toBe(403);
		expect(await status(files.writeText('app', 'escape/new', 'x', { create: true }))).toBe(403);
		expect(await status(files.uploadFile('app', 'escape/up', body('x'), false))).toBe(403);
		// the link itself can be removed, its target stays
		await files.removePath('app', 'escape');
		expect(await readFile(path.join(base, 'outside', 'secret'), 'utf8')).toBe('nope');
	});

	it('uploads, renames and deletes', async () => {
		await files.uploadFile('app', 'data/a.txt', body('one'), false);
		expect(await status(files.uploadFile('app', 'data/a.txt', body('two'), false))).toBe(409);
		await files.uploadFile('app', 'data/a.txt', body('two'), true);
		expect((await files.readText('app', 'data/a.txt')).content).toBe('two');
		await files.movePath('app', 'data/a.txt', 'data/b.txt');
		expect(await status(files.movePath('app', 'data', 'data/sub'))).toBe(400);
		await files.makeDir('app', 'empty');
		await files.removePath('app', 'data');
		const names = (await files.listDir('app', '')).map((e) => e.name);
		expect(names).toContain('empty');
		expect(names).not.toContain('data');
	});

	it('reports binary files', async () => {
		await writeFile(path.join(base, 'projects', 'app', 'bin'), Buffer.from([1, 0, 2]));
		expect((await files.readText('app', 'bin')).reason).toBe('binary');
	});
});
