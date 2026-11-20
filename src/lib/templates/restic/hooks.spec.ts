import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { mergeCompose } from '#lib/dockit-config.js';
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

const add = (source: string, service: string, composeName: string, preset?: 'postgres' | 'redis') =>
	addRunner(parse(source), '', service, composeName, preset);
const merged = (source: string, override: string) =>
	mergeCompose(parse(source), parse(override) ?? null) as ReturnType<typeof parse>;

describe('hook runners', () => {
	it('names the hook variables', () => {
		expect(hookVar('pre-backup')).toBe('HOOK_PRE_BACKUP');
		expect(hookVar('restore-failed')).toBe('HOOK_RESTORE_FAILED');
	});

	it('adds a runner to the override file', () => {
		const out = add(compose, 'db', 'myapp', 'postgres');
		expect(out).toMatchObject({
			volumes: ['myapp_pgdata']
		});
		expect(out.override).toContain('# Backup hooks of db');
		expect(Object.keys(parse(out.override).services)).toEqual(['db-hooks']);
		const json = merged(compose, out.override);
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
		const json = merged(compose, add(compose, 'db', 'myapp', 'postgres').override);
		expect(runnerCandidates(json)).toEqual([{ name: 'app', image: 'ghcr.io/me/app:1' }]);
	});

	it('adds an empty runner without a template', () => {
		const out = add(compose, 'app', 'myapp');
		expect(out.volumes).toEqual([]);
		expect(readRunners(parse(out.override))[0]).toMatchObject({ target: 'app', phases: [] });
	});

	it('keeps the volumes of snapshot presets in the backup', () => {
		const source = `services:
  cache:
    image: redis:7
    volumes: [data:/data]
volumes:
  data:
`;
		const out = add(source, 'cache', 'myapp', 'redis');
		expect(out.volumes).toEqual([]);
		const runner = parse(out.override).services['cache-hooks'];
		expect(runner.environment.HOOK_PRE_BACKUP).toContain('redis-cli -h cache SAVE');
		expect(readRunners(parse(out.override))[0].phases).toEqual(['pre-backup']);
	});

	it('refuses services it can not add a runner for', () => {
		const added = merged(compose, add(compose, 'db', 'myapp', 'postgres').override);
		expect(() => addRunner(added, '', 'db', 'myapp')).toThrow(/already/);
		expect(() => addRunner(added, '', 'db-hooks', 'myapp')).toThrow(/runner itself/);
		expect(() => add(compose, 'nope', 'myapp')).toThrow(/no service/);
		expect(() => add('services:\n  web:\n    build: .\n', 'web', 'myapp')).toThrow(/no image/);
	});

	it('keeps the services of an existing override file', () => {
		const override = '# mine\nservices:\n  db:\n    restart: always\n';
		const out = addRunner(merged(compose, override), override, 'db', 'myapp');
		expect(out.override).toContain('# mine');
		expect(Object.keys(parse(out.override).services)).toEqual(['db', 'db-hooks']);
	});

	it('removes a runner from the override file, then the file is empty', () => {
		const { override } = add(compose, 'db', 'myapp', 'postgres');
		expect(removeRunner(compose, override, 'db-hooks')).toEqual({ compose, override: '' });
		expect(() => removeRunner(compose, override, 'db')).toThrow(/not a hook runner/);
	});

	it('removes a runner of an older project from the compose file', () => {
		const legacy = `services:
  app:
    image: nginx
  app-hooks:
    image: nginx
    environment:
      HOOKS_NAME: app-hooks
`;
		const out = removeRunner(legacy, '', 'app-hooks');
		expect(parse(out.compose)).toEqual({ services: { app: { image: 'nginx' } } });
		expect(out.override).toBe('');
	});
});
