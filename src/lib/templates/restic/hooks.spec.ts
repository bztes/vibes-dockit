import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
	addHooks,
	containerName,
	hookCandidates,
	hookCommand,
	hookedServices,
	hooksSection,
	phaseScripts,
	readHooks
} from './hooks';

const compose = parse(`services:
  app:
    image: ghcr.io/me/app:1
    depends_on: [db]
  db:
    image: postgres:17-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./init:/docker-entrypoint-initdb.d
  cache:
    image: redis:7
    container_name: my-cache
    volumes: [cache:/data]
volumes:
  pgdata:
  cache:
`);

describe('backup hooks', () => {
	it('reads only the phases with a script', () => {
		const hooks = readHooks({
			db: { 'pre-backup': ' pg_dump \n', 'post-backup': '  ', nope: 'x' },
			custom: {},
			broken: 'x'
		});
		expect(hooks).toEqual({ db: { 'pre-backup': 'pg_dump' }, custom: {} });
		expect(hooksSection(hooks)).toEqual(hooks);
		expect(hooksSection({})).toBeNull();
	});

	it('names the container of a service', () => {
		expect(containerName(compose.services.db, 'db', 'myapp')).toBe('myapp-db-1');
		expect(containerName(compose.services.cache, 'cache', 'myapp')).toBe('my-cache');
	});

	it('adds the hooks of a dump preset and drops the volume from the backup', () => {
		const out = addHooks(compose, {}, 'db', 'myapp', 'postgres');
		expect(out.volumes).toEqual(['myapp_pgdata']);
		expect(Object.keys(out.hooks.db)).toEqual(['pre-backup', 'post-restore']);
		expect(out.hooks.db['pre-backup']).toContain(
			`docker exec myapp-db-1 sh -c 'export PGUSER="\${POSTGRES_USER:-postgres}"; db="\${POSTGRES_DB:-$PGUSER}"; pg_dump -Fc "$db"' >.backup/db.dump.tmp`
		);
		expect(out.hooks.db['post-restore']).toContain('docker exec -i myapp-db-1 sh -c');
		expect(out.hooks.db['post-restore']).toContain('<.backup/db.dump');
	});

	it('keeps the volumes of snapshot presets in the backup', () => {
		const out = addHooks(compose, {}, 'cache', 'myapp', 'redis');
		expect(out.volumes).toEqual([]);
		expect(out.hooks.cache['pre-backup']).toContain('docker exec my-cache sh -c');
		expect(out.hooks.cache['pre-backup']).toContain('redis-cli SAVE');
	});

	it('adds empty hooks without a template', () => {
		expect(addHooks(compose, {}, 'app', 'myapp')).toEqual({ hooks: { app: {} }, volumes: [] });
	});

	it('refuses services it can not add hooks for', () => {
		expect(() => addHooks(compose, { db: {} }, 'db', 'myapp')).toThrow(/already/);
		expect(() => addHooks(compose, {}, 'nope', 'myapp')).toThrow(/no service/);
	});

	it('lists the services with and without hooks', () => {
		const hooks = { db: {}, gone: {} };
		expect(hookCandidates(compose, hooks)).toEqual(['app', 'cache']);
		expect(hookedServices(compose, hooks)).toEqual(['db']);
		expect(hookedServices(null, hooks)).toEqual([]);
	});

	it('runs the scripts of a phase in the project folder', () => {
		const hooks = {
			db: { 'pre-backup': 'a' },
			app: { 'post-backup': 'b' },
			x: { 'pre-backup': 'c' }
		};
		expect(phaseScripts(hooks, 'pre-backup')).toEqual([
			{ name: 'db', script: 'a' },
			{ name: 'x', script: 'c' }
		]);
		expect(hookCommand("/srv/it's", 'pre-backup', 'db', 'a')).toBe(
			"set -e\necho '--- pre-backup hooks of db'\ncd '/srv/it'\\''s'\na\n"
		);
	});
});
