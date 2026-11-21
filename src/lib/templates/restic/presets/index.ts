import custom from './custom';
import influxdb from './influxdb';
import mariadb from './mariadb';
import mongo from './mongo';
import mysql from './mysql';
import postgres from './postgres';
import redis from './redis';
import valkey from './valkey';
import type { HookSet } from '../hooks';
import type { PresetDef } from './shared';

/** Hook templates, chosen when hooks are added (no server imports: also used by the client). */
export const PRESET_INFO = {
	custom,
	postgres,
	mysql,
	mariadb,
	mongo,
	redis,
	valkey,
	influxdb
} as const satisfies Record<string, PresetDef>;

export type Preset = keyof typeof PRESET_INFO;
export const PRESETS = Object.keys(PRESET_INFO) as [Preset, ...Preset[]];

/** The hooks of a preset for the container `c` of the service `name`. */
export const presetHooks = (preset: Preset, c: string, name: string): HookSet =>
	PRESET_INFO[preset].hooks(c, name);
