import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { applyProxy, caddySites, readProxy, readRoutes } from './proxy';

const base = `# my app
x-dockit:
  description: My app

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

const read = (src: string) => readProxy(parse(src));

describe('proxy routes', () => {
	it('stores the routes in x-dockit and joins the caddy network', () => {
		const out = applyProxy(
			base,
			[{ service: 'app', port: 80, domains: ['app.example.com', 'www.example.com'] }],
			'caddy'
		);
		const json = parse(out);
		expect(out).toContain('# my app');
		expect(out).toContain('# web');
		expect(json['x-dockit'].description).toBe('My app');
		expect(json['x-dockit'].domains).toEqual([
			{ service: 'app', port: 80, domains: ['app.example.com', 'www.example.com'] }
		]);
		expect(json.services.app.labels).toBeUndefined();
		expect(json.services.app.networks).toEqual(['default', 'caddy']);
		expect(json.services.db.networks).toEqual(['backend']);
		expect(json.networks.caddy).toEqual({ name: 'caddy', external: true });
		expect(read(out)[0]).toMatchObject({ routes: json['x-dockit'].domains });
	});

	it('changing a domain only touches x-dockit, not the services', () => {
		const first = applyProxy(base, [{ service: 'app', port: 80, domains: ['a.dev'] }], 'caddy');
		const second = applyProxy(first, [{ service: 'app', port: 80, domains: ['b.dev'] }], 'caddy');
		expect(parse(second).services).toEqual(parse(first).services);
		expect(readRoutes(parse(second))[0].domains).toEqual(['b.dev']);
	});

	it('supports several routes per service and across services', () => {
		const out = applyProxy(
			base,
			[
				{ service: 'db', port: 5432, domains: ['db.example.com'] },
				{ service: 'app', port: 80, domains: ['a.example.com'] },
				{ service: 'app', port: 9000, domains: ['admin.example.com'] }
			],
			'proxy'
		);
		const json = parse(out);
		expect(json.services.db.networks).toEqual(['backend', 'caddy']);
		expect(json.networks.caddy.name).toBe('proxy');
		expect(readRoutes(json).map((r) => r.domains[0])).toEqual([
			'a.example.com',
			'admin.example.com',
			'db.example.com'
		]);
	});

	it('removing all routes restores the original file', () => {
		const added = applyProxy(base, [{ service: 'app', port: 80, domains: ['a.com'] }], 'caddy');
		const removed = applyProxy(added, [], 'caddy');
		expect(parse(removed)).toEqual(parse(base));
		expect(removed).toContain('# web');
	});

	it('ignores invalid routes', () => {
		const src = `x-dockit:\n  domains:\n    - { service: app, port: 0, domains: [a.dev] }\n    - { service: app, port: 80, domains: ["bad domain"] }\n    - { service: app, port: 80, domains: [ok.dev] }\nservices:\n  app:\n    image: x\n`;
		expect(readRoutes(parse(src))).toEqual([{ service: 'app', port: 80, domains: ['ok.dev'] }]);
	});

	it('suggests container ports', () => {
		const src = `services:\n  app:\n    image: x\n    ports: ["127.0.0.1:8080:3000/tcp"]\n    expose: [9000]\n`;
		expect(read(src)[0].ports).toEqual([3000, 9000]);
	});
});

describe('caddyfile', () => {
	it('generates a site per route with the container name as upstream', () => {
		const blog = applyProxy(
			base,
			[{ service: 'app', port: 80, domains: ['a.dev', 'b.dev'] }],
			'caddy'
		);
		const named = `x-dockit:\n  domains: [{ service: web, port: 3000, domains: [c.dev, a.dev] }]\nservices:\n  web:\n    image: x\n    container_name: my-web\n`;
		const out = caddySites([
			{ project: 'zeta', composeName: 'zeta', json: parse(named) },
			{ project: 'Blog', composeName: 'blog', json: parse(blog) }
		]);
		expect(out).toContain('a.dev, b.dev {\n\treverse_proxy blog-app-1:80\n}');
		// a.dev is already served by Blog
		expect(out).toContain('c.dev {\n\treverse_proxy my-web:3000\n}');
	});
});
