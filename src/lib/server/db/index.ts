import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import { desc, lt } from 'drizzle-orm';
import * as schema from './schema';
import { DOCKIT_DATA_DIR } from '$app/env/private';

export const dataDir = path.resolve(DOCKIT_DATA_DIR);
mkdirSync(dataDir, { recursive: true });

const client = createClient({ url: `file:${path.join(dataDir, 'dockit.db')}` });

export const db = drizzle(client, { schema });

let migrated: Promise<void> | undefined;

/** Creates/updates all tables. The db is disposable, so it is always safe to run. */
export function ensureDb() {
	migrated ??= (async () => {
		await client.execute('PRAGMA journal_mode = WAL');
		await client.execute('PRAGMA foreign_keys = ON');
		await migrate(db, { migrationsFolder: path.resolve('drizzle') });
	})();
	return migrated;
}

export async function logActivity(
	entry: Omit<typeof schema.activity.$inferInsert, 'id' | 'createdAt'>
) {
	try {
		await db.insert(schema.activity).values(entry);
		// keep the log small
		const rows = await db
			.select({ id: schema.activity.id })
			.from(schema.activity)
			.orderBy(desc(schema.activity.id))
			.limit(1)
			.offset(1000);
		if (rows[0]) await db.delete(schema.activity).where(lt(schema.activity.id, rows[0].id));
	} catch (e) {
		console.error('[dockit] failed to write activity', e);
	}
}
