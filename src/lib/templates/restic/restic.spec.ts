import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
	applyRestic,
	dockitProfiles,
	envValue,
	localRepository,
	mainProfiles,
	parseSnapshots,
	pathVolume,
	parseRepository,
	readRestic,
	repositoryProblem,
	resolveExclude,
	volumePath
} from './restic';

const base = `# my app
x-dockit:
  description: My app

services:
  app:
    image: nginx:alpine # web
`;

describe('x-dockit.restic', () => {
	it('writes and reads the settings, keeping the file', () => {
		const out = applyRestic(base, {
			schedule: 'daily',
			exclude: ['/logs', '*.tmp'],
			excludeVolumes: ['app_cache'],
			beforeUpdate: true
		});
		expect(out).toContain('# my app');
		expect(out).toContain('# web');
		const json = parse(out);
		expect(json['x-dockit'].description).toBe('My app');
		expect(json['x-dockit'].restic).toEqual({
			schedule: 'daily',
			exclude: ['/logs', '*.tmp'],
			'exclude-volumes': ['app_cache'],
			'before-update': true
		});
		expect(readRestic(json)).toEqual({
			schedule: 'daily',
			exclude: ['/logs', '*.tmp'],
			excludeVolumes: ['app_cache'],
			beforeUpdate: true
		});
	});

	it('creates the x-dockit block on top and removes it again', () => {
		const src = 'services:\n  app:\n    image: nginx\n';
		const out = applyRestic(src, {
			schedule: '',
			exclude: [],
			excludeVolumes: [],
			beforeUpdate: false
		});
		expect(out.startsWith('x-dockit:')).toBe(true);
		expect(readRestic(parse(out))).toEqual({
			schedule: '',
			exclude: [],
			excludeVolumes: [],
			beforeUpdate: false
		});
		expect(parse(applyRestic(out, null))).toEqual(parse(src));
	});

	it('is disabled without a block', () => {
		expect(readRestic(parse(base))).toBeNull();
		expect(readRestic({ 'x-dockit': { restic: null } })).toBeNull();
	});
});

describe('profiles', () => {
	it('resolves excludes relative to the project folder', () => {
		expect(
			resolveExclude('/opt/stacks/app', ['/logs/', '*.tmp', '!/logs/keep', 'cache/x'])
		).toEqual(['/opt/stacks/app/logs', '*.tmp', '!/opt/stacks/app/logs/keep', 'cache/x']);
	});

	it('generates one profile per project', () => {
		const out = parse(
			dockitProfiles([
				{
					project: 'app',
					dir: '/opt/stacks/app',
					volumes: ['app_cache', 'app_data'],
					settings: {
						schedule: 'daily',
						exclude: ['/logs'],
						excludeVolumes: ['app_cache'],
						beforeUpdate: false
					},
					hooks: true
				},
				{
					project: 'default',
					dir: '/opt/stacks/default',
					volumes: [],
					settings: { schedule: '', exclude: [], excludeVolumes: [], beforeUpdate: false },
					hooks: false
				}
			])
		);
		expect(out.global).toEqual({ scheduler: 'crond' });
		expect(out['dockit-app']).toEqual({
			inherit: 'default',
			backup: {
				source: ['/opt/stacks/app', volumePath('app_data')],
				exclude: [
					'/opt/stacks/app/logs',
					'/opt/stacks/app/.backup/agents',
					'/opt/stacks/app/.backup/requests',
					'/opt/stacks/app/.backup/results'
				],
				tag: ['project=app'],
				'run-before': "sh /resticprofile/hooks.sh pre-backup '/opt/stacks/app'",
				'run-after': "sh /resticprofile/hooks.sh post-backup '/opt/stacks/app'",
				'run-after-fail': "sh /resticprofile/hooks.sh backup-failed '/opt/stacks/app'",
				schedule: 'daily',
				'schedule-permission': 'system',
				'schedule-lock-wait': '2h',
				'schedule-log': '/proc/1/fd/1'
			},
			retention: { path: false, tag: ['project=app'], 'group-by': 'tags' }
		});
		// no schedule = manual backups only, the name can't clash with the default profile
		expect(out['dockit-default'].backup.schedule).toBeUndefined();
		// without runners there is nothing to call
		expect(out['dockit-default'].backup['run-before']).toBeUndefined();
		expect(out.default).toBeUndefined();
	});

	it('writes a valid main file', () => {
		const out = parse(
			mainProfiles('s3:host/bucket', { keepDaily: 7, keepWeekly: 4, keepMonthly: 6 })
		);
		expect(out.includes).toEqual(['dockit.yaml']);
		expect(out.default.repository).toBe('s3:host/bucket');
		expect(out.default.retention['keep-daily']).toBe(7);
		expect(out.prune.prune.schedule).toBe('Sun 04:00');
	});

	it('leaves out retention and prune for append-only repositories', () => {
		const out = parse(mainProfiles('rest:https://host:8000/', null));
		expect(out.includes).toEqual(['dockit.yaml']);
		expect(out.default.repository).toBe('rest:https://host:8000/');
		expect(out.default.retention).toBeUndefined();
		expect(out.prune).toBeUndefined();
	});

	it('detects local repositories', () => {
		expect(localRepository('/srv/restic/')).toBe('/srv/restic');
		expect(localRepository('local:/srv/restic')).toBe('/srv/restic');
		expect(localRepository('s3:s3.amazonaws.com/bucket')).toBeNull();
		expect(localRepository('sftp:host:/srv')).toBeNull();
	});

	it('parses repositories', () => {
		expect(parseRepository('  ')).toBeNull();
		expect(parseRepository('/srv/restic')).toMatchObject({ backend: 'local', problem: null });
		expect(parseRepository('local:/srv/restic')).toMatchObject({
			backend: 'local',
			location: '/srv/restic',
			problem: null
		});
		expect(parseRepository('srv/restic')?.problem).toMatch(/absolute/);
		expect(parseRepository('foo:bar')?.problem).toMatch(/Unknown/);
		expect(parseRepository('s3:s3.amazonaws.com/bucket')).toMatchObject({
			backend: 's3',
			location: 's3.amazonaws.com/bucket',
			problem: null
		});
		expect(parseRepository('sftp:host:/srv')).toMatchObject({ backend: 'sftp', problem: null });
		expect(parseRepository('b2:')?.problem).toMatch(/missing/);
		expect(parseRepository('rest:https://host:8000/nico/')).toMatchObject({
			backend: 'rest',
			label: 'REST server',
			location: 'https://host:8000/nico/',
			problem: null
		});
		expect(parseRepository('rest:host:8000')?.problem).toMatch(/http/);
		expect(parseRepository('rest:nope')?.problem).toMatch(/Invalid/);
		expect(parseRepository('rest:https://nico:pw@host/')?.problem).toMatch(/own fields/);
	});

	it('checks the repository of the form', () => {
		const values = { repository: '/srv/backups/restic', restUser: '', restPassword: '' };
		expect(repositoryProblem(values)).toBeNull();
		expect(repositoryProblem({ ...values, repository: '' })).toMatch(/required/);
		const rest = { ...values, repository: 'rest:https://host:8000/', restUser: 'nico' };
		expect(repositoryProblem(rest)).toBeNull();
		expect(repositoryProblem({ ...rest, restPassword: "it's" })).toMatch(/quotes/);
		// credentials of other repositories are ignored
		expect(repositoryProblem({ ...values, restPassword: "it's" })).toBeNull();
	});

	it('quotes .env values', () => {
		expect(envValue('pa$$ "word"')).toBe(`'pa$$ "word"'`);
		expect(() => envValue("it's")).toThrow();
	});

	it('maps volume paths back to volumes', () => {
		expect(pathVolume(volumePath('app_data'))).toBe('app_data');
		expect(pathVolume('/opt/stacks/app')).toBeNull();
	});
});

describe('snapshots', () => {
	it('parses restic json between log lines, newest first', () => {
		const out = parseSnapshots(
			[
				'2026/11/18 10:00:00 profile default: starting snapshots',
				JSON.stringify([
					{ id: 'a'.repeat(64), short_id: 'aaaaaaaa', time: '2026-11-17T03:00:00Z', paths: ['/x'] },
					{
						id: 'b'.repeat(64),
						time: '2026-11-18T03:00:00Z',
						paths: ['/x'],
						tags: ['project=x'],
						summary: { data_added: 10, total_bytes_processed: 100 }
					}
				]),
				''
			].join('\n')
		);
		expect(out.map((s) => s.shortId)).toEqual(['bbbbbbbb', 'aaaaaaaa']);
		expect(out[0]).toMatchObject({ added: 10, size: 100, tags: ['project=x'] });
		expect(out[1]).toMatchObject({ added: null, size: null, tags: [] });
	});
});
