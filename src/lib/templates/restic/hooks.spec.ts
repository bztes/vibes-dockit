import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { addRunner, hookVar, readRunners, removeRunner, runnerCandidates } from './hooks';

const compose = `# my app
services:
  app:
    image: ghcr.io/me/app:1 # the app
    depends_on: [db]

  db:
    image: postgres:17-alpine
    env_file: .env
    environment:
      - POSTGRES_PASSWORD=\${DB_PASSWORD}
      - POSTGRES_DB=app
    networks:
      backend:
        aliases: [database]
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./init:/docker-entrypoint-initdb.d

networks:
  backend:

volumes:
  pgdata:
`;

describe('hook runners', () => {
	it('names the hook variables', () => {
		expect(hookVar('pre-backup')).toBe('HOOK_PRE_BACKUP');
		expect(hookVar('restore-failed')).toBe('HOOK_RESTORE_FAILED');
	});

	it('adds a runner after its service, keeping the file', () => {
		const out = addRunner(compose, 'db', 'myapp', 'postgres');
		expect(out).toMatchObject({
			volumes: ['myapp_pgdata']
		});
		expect(out.source).toContain('# my app');
		expect(out.source).toContain('# the app');
		expect(out.source).toContain('# Backup hooks of db');
		const json = parse(out.source);
		expect(Object.keys(json.services)).toEqual(['app', 'db', 'db-hooks']);
		const runner = json.services['db-hooks'];
		expect(runner).toMatchObject({
			image: 'postgres:17-alpine',
			env_file: '.env',
			depends_on: ['db'],
			volumes_from: ['db'],
			volumes: ['./.backup:/backup'],
			entrypoint: ['sh', '/backup/agent.sh'],
			networks: ['backend']
		});
		expect(runner.environment).toMatchObject({
			POSTGRES_PASSWORD: '${DB_PASSWORD}',
			POSTGRES_DB: 'app',
			HOOKS_NAME: 'db-hooks',
			PGHOST: 'db'
		});
		// compose turns $$ into the $ of the shell
		expect(runner.environment.HOOK_PRE_BACKUP).toContain('"$${POSTGRES_DB:-$$PGUSER}"');
		expect(runner.environment.HOOK_POST_RESTORE).toContain('pg_restore --clean');
		expect(readRunners(json)).toEqual([
			{
				service: 'db-hooks',
				name: 'db-hooks',
				target: 'db',
				phases: ['pre-backup', 'post-restore']
			}
		]);
	});

	it('only offers services without a runner', () => {
		expect(runnerCandidates(parse(compose)).map((c) => c.name)).toEqual(['app', 'db']);
		const json = parse(addRunner(compose, 'db', 'myapp', 'postgres').source);
		expect(runnerCandidates(json)).toEqual([{ name: 'app', image: 'ghcr.io/me/app:1' }]);
	});

	it('adds an empty runner without a template', () => {
		const out = addRunner(compose, 'app', 'myapp');
		expect(out.volumes).toEqual([]);
		expect(readRunners(parse(out.source))[0]).toMatchObject({ target: 'app', phases: [] });
	});

	it('keeps the volumes of snapshot presets in the backup', () => {
		const source = `services:
  cache:
    image: redis:7
    volumes: [data:/data]
volumes:
  data:
`;
		const out = addRunner(source, 'cache', 'myapp', 'redis');
		expect(out.volumes).toEqual([]);
		const runner = parse(out.source).services['cache-hooks'];
		expect(runner.environment.HOOK_PRE_BACKUP).toContain('redis-cli -h cache SAVE');
		expect(readRunners(parse(out.source))[0].phases).toEqual(['pre-backup']);
	});

	it('refuses services it can not add a runner for', () => {
		const added = addRunner(compose, 'db', 'myapp', 'postgres').source;
		expect(() => addRunner(added, 'db', 'myapp')).toThrow(/already/);
		expect(() => addRunner(added, 'db-hooks', 'myapp')).toThrow(/runner itself/);
		expect(() => addRunner(compose, 'nope', 'myapp')).toThrow(/no service/);
		expect(() => addRunner('services:\n  web:\n    build: .\n', 'web', 'myapp')).toThrow(
			/no image/
		);
	});

	it('removes a runner', () => {
		const added = addRunner(compose, 'db', 'myapp', 'postgres').source;
		expect(parse(removeRunner(added, 'db-hooks'))).toEqual(parse(compose));
		expect(() => removeRunner(added, 'db')).toThrow(/not a hook runner/);
	});
});
