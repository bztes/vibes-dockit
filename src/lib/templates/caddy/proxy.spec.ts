import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { mergeCompose } from '#lib/dockit-config.js';
import {
	applyProxy,
	caddySites,
	certNames,
	duplicateDomain,
	proxySection,
	readProxy,
	readRoutes,
	redundantPublished,
	type PublishedPort
} from './proxy';

const source = `# my app
services:
  app:
    image: nginx:alpine # web
    ports:
      - "8080:80"
  db:
    image: postgres:17
    networks: [backend]

networks:
  backend: {}
`;
const base = parse(source);

describe('proxy routes', () => {
	it('joins the caddy network in the override file', () => {
		const out = applyProxy(base, '', ['app'], 'caddy');
		const json = parse(out);
		expect(json).toEqual({
			services: { app: { networks: ['default', 'caddy'] } },
			networks: { caddy: { name: 'caddy', external: true } }
		});
	});

	it('adds to the networks of the compose file', () => {
		const json = parse(applyProxy(base, '', ['db', 'app'], 'proxy'));
		expect(json.services.db.networks).toEqual(['caddy']);
		expect(json.networks.caddy.name).toBe('proxy');
		const merged = mergeCompose(base, json);
		expect((merged.services as Record<string, { networks: string[] }>).db.networks).toEqual([
			'backend',
			'caddy'
		]);
	});

	it('keeps an existing override file and removes only its own entries', () => {
		const override = '# mine\nservices:\n  app:\n    restart: always # yes\n';
		const added = applyProxy(base, override, ['app'], 'caddy');
		expect(added).toContain('# yes');
		const removed = applyProxy(base, added, [], 'caddy');
		expect(parse(removed)).toEqual(parse(override));
		expect(removed).toContain('# yes');
	});

	it('removing all routes empties the override file', () => {
		const added = applyProxy(base, '', ['app', 'db'], 'caddy');
		expect(applyProxy(base, added, [], 'caddy')).toBe('');
	});

	it('leaves services attached by the user alone', () => {
		const own = parse(source.replace('networks: [backend]', 'networks: [backend, caddy]'));
		own.networks.caddy = { external: true };
		expect(applyProxy(own, '', ['db'], 'caddy')).toBe('');
	});

	it('refuses unknown services and network_mode', () => {
		expect(() => applyProxy(base, '', ['nope'], 'caddy')).toThrow(/Unknown service/);
		const host = parse('services:\n  app:\n    image: x\n    network_mode: host\n');
		expect(() => applyProxy(host, '', ['app'], 'caddy')).toThrow(/network_mode/);
	});

	it('stores the routes in the order of the services', () => {
		const section = proxySection(
			{ other: 1 },
			[
				{ service: 'db', port: 5432, domains: ['db.example.com'] },
				{ service: 'app', port: 80, domains: ['a.example.com'] }
			],
			['app', 'db']
		);
		expect(readRoutes(section).map((r) => r.service)).toEqual(['app', 'db']);
		expect(section?.other).toBe(1);
		expect(proxySection({ domains: [] }, [], [])).toBeNull();
	});

	it('ignores invalid routes', () => {
		const section = {
			domains: [
				{ service: 'app', port: 0, domains: ['a.dev'] },
				{ service: 'app', port: 80, domains: ['bad domain'] },
				{ service: 'app', port: 80, domains: ['ok.dev'] }
			]
		};
		expect(readRoutes(section)).toEqual([{ service: 'app', port: 80, domains: ['ok.dev'] }]);
	});

	it('suggests container ports', () => {
		const src = `services:\n  app:\n    image: x\n    ports: ["127.0.0.1:8080:3000/tcp"]\n    expose: [9000]\n`;
		expect(readProxy(parse(src), null)[0].ports).toEqual([3000, 9000]);
	});
});

describe('caddyfile', () => {
	it('generates a site per route with the container name as upstream', () => {
		const named = parse(`services:\n  web:\n    image: x\n    container_name: my-web\n`);
		const out = caddySites([
			{
				project: 'zeta',
				composeName: 'zeta',
				compose: named,
				section: { domains: [{ service: 'web', port: 3000, domains: ['c.dev', 'a.dev'] }] }
			},
			{
				project: 'Blog',
				composeName: 'blog',
				compose: base,
				section: { domains: [{ service: 'app', port: 80, domains: ['a.dev', 'b.dev'] }] }
			}
		]);
		expect(out).toContain('a.dev, b.dev {\n\treverse_proxy blog-app-1:80\n}');
		// a.dev is already served by Blog
		expect(out).toContain('c.dev {\n\treverse_proxy my-web:3000\n}');
	});
});

describe('redirects', () => {
	const route = {
		service: 'app',
		port: 80,
		domains: ['example.com', 'app.example.com'],
		redirects: ['www.example.com']
	};

	it('stores the redirects with the route', () => {
		expect(readRoutes({ domains: [route] })).toEqual([route]);
		expect(proxySection(null, [route], ['app'])).toEqual({ domains: [route] });
		expect(proxySection(null, [{ ...route, redirects: [] }], ['app'])).toEqual({
			domains: [{ service: 'app', port: 80, domains: route.domains }]
		});
		expect(readRoutes({ domains: [{ ...route, redirects: ['not a domain'] }] })).toEqual([]);
	});

	it('redirects to the first domain', () => {
		const out = caddySites([
			{ project: 'blog', composeName: 'blog', compose: base, section: { domains: [route] } }
		]);
		expect(out).toContain('www.example.com {\n\tredir https://example.com{uri} permanent\n}');
	});

	it('counts redirects as used domains', () => {
		expect(duplicateDomain([route, { service: 'db', port: 1, domains: ['www.example.com'] }])).toBe(
			'www.example.com'
		);
	});
});

describe('certificate links', () => {
	it('stores the flag with the route', () => {
		const route = { service: 'app', port: 80, domains: ['a.dev'], certs: true };
		expect(readRoutes({ domains: [route] })).toEqual([route]);
		expect(proxySection(null, [route], ['app'])).toEqual({ domains: [route] });
		expect(readRoutes({ domains: [{ ...route, certs: 'yes' }] })[0].certs).toBeUndefined();
	});

	it('links every domain with a certificate once', () => {
		expect(
			certNames([
				{
					service: 'app',
					port: 80,
					domains: ['a.dev', 'https://b.dev:8443', '*.c.dev', 'http://d.dev'],
					certs: true
				},
				{ service: 'db', port: 5432, domains: ['e.dev'] },
				{ service: 'web', port: 80, domains: ['a.dev'], certs: true }
			])
		).toEqual(['a.dev', 'b.dev', 'wildcard_.c.dev']);
	});
});

describe('redundant published ports', () => {
	const published: PublishedPort[] = [
		{ spec: '3000:3000', target: [3000, 3000] },
		{ spec: '2222:22', target: [22, 22] },
		{ spec: '9000-9010:9000-9010', target: [9000, 9010] }
	];

	it('only flags ports that a route already uses', () => {
		expect(redundantPublished(published, [3000])).toEqual(['3000:3000']);
		expect(redundantPublished(published, [9005])).toEqual(['9000-9010:9000-9010']);
		expect(redundantPublished(published, [8080])).toEqual([]);
	});
});
