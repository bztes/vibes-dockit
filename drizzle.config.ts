import path from 'node:path';
import { defineConfig } from 'drizzle-kit';

// same location as the app: <DOCKIT_DATA_DIR>/dockit.db
const dataDir = path.resolve(process.env.DOCKIT_DATA_DIR || './data');

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	dialect: 'sqlite',
	dbCredentials: { url: `file:${path.join(dataDir, 'dockit.db')}` },
	verbose: true,
	strict: true
});
