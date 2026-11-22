import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runOk } from './exec';

/**
 * Registry logins live in a regular docker config (`DOCKER_CONFIG`, in the
 * image `/data/docker`), written by `docker login`. Pulls by the docker cli and
 * the update checks both read it, and it works without Dockit too
 * (`DOCKER_CONFIG=<data>/docker docker compose pull`).
 */

export const DOCKER_HUB = 'docker.io';
const HUB_KEYS = [
	'index.docker.io',
	'docker.io',
	'registry-1.docker.io'
];

function dockerConfigDir() {
	return process.env.DOCKER_CONFIG ?? path.join(os.homedir(), '.docker');
}

interface DockerConfig {
	auths?: Record<string, { auth?: string }>;
}

function readConfig(): DockerConfig {
	try {
		return JSON.parse(readFileSync(path.join(dockerConfigDir(), 'config.json'), 'utf8'));
	} catch {
		return {};
	}
}

/** base64 `user:password` for a registry, if stored in the config file */
export function basicAuthFor(registry: string): string | null {
	const auths = readConfig().auths ?? {};
	for (const [key, value] of Object.entries(auths)) {
		if (value.auth && normalizeRegistry(key) === registry) return value.auth;
	}
	return null;
}

export interface RegistryLogin {
	registry: string;
	/** null when the credentials are kept by a credential helper */
	username: string | null;
}

export function listRegistryLogins(): RegistryLogin[] {
	const logins = new Map<string, RegistryLogin>();
	for (const [key, value] of Object.entries(readConfig().auths ?? {})) {
		let username: string | null = null;
		if (value.auth) {
			const decoded = Buffer.from(value.auth, 'base64').toString('utf8');
			username = decoded.slice(0, Math.max(0, decoded.indexOf(':'))) || null;
		}
		const registry = normalizeRegistry(key);
		if (!logins.get(registry)?.username) logins.set(registry, { registry, username });
	}
	return [...logins.values()].sort((a, b) => a.registry.localeCompare(b.registry));
}

/** `registry.example.com[:port]`, lower case, no scheme or path */
export const REGISTRY_PATTERN =
	/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/;

/** Canonical registry name of a config key, user input or image ref host (Hub aliases → `docker.io`). */
export function normalizeRegistry(input: string) {
	const host = input
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, '')
		.replace(/\/.*$/, '');
	return HUB_KEYS.includes(host) ? DOCKER_HUB : host;
}

/** Checks the credentials against the registry and stores them. */
export async function registryLogin(registry: string, username: string, password: string) {
	await runOk('docker', ['login', registry, '--username', username, '--password-stdin'], {
		input: password,
		timeout: 30_000
	});
}

export async function registryLogout(registry: string) {
	await runOk('docker', ['logout', registry], { timeout: 30_000 });
}
