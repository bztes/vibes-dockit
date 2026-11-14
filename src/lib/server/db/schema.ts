import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Channel, EventType } from '../../notifications';

/**
 * Everything in this database is disposable: deleting the db file only means
 * users (and their notification channels) have to be created again. Project data lives in compose/.env files and
 * app settings live in config.json.
 */

export const user = sqliteTable('user', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	role: text('role', { enum: ['admin', 'user'] })
		.notNull()
		.default('user'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const session = sqliteTable('session', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull()
});

/** Notification channels, owned by a user. The SMTP server is global (config.json). */
export const notificationChannel = sqliteTable('notification_channel', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	type: text('type', { enum: ['ntfy', 'email', 'webhook'] }).notNull(),
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
	events: text('events', { mode: 'json' }).$type<EventType[]>().notNull(),
	/** folder names; empty = all projects */
	projects: text('projects', { mode: 'json' }).$type<string[]>().notNull(),
	config: text('config', { mode: 'json' }).$type<Channel['config']>().notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

/** Cache of the last update check per project image. */
export const updateCheck = sqliteTable('update_check', {
	id: text('id').primaryKey(), // `${project}|${image}`
	project: text('project').notNull(),
	image: text('image').notNull(),
	services: text('services').notNull().default(''),
	status: text('status', {
		enum: ['up-to-date', 'available', 'error', 'unknown', 'pinned']
	}).notNull(),
	localDigest: text('local_digest'),
	remoteDigest: text('remote_digest'),
	notifiedDigest: text('notified_digest'),
	error: text('error'),
	checkedAt: integer('checked_at', { mode: 'timestamp' }).notNull()
});

/** Activity log (actions, failures, notifications). */
export const activity = sqliteTable('activity', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	project: text('project'),
	type: text('type').notNull(),
	level: text('level', { enum: ['info', 'success', 'warning', 'error'] })
		.notNull()
		.default('info'),
	message: text('message').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export type User = typeof user.$inferSelect;
export type UpdateCheck = typeof updateCheck.$inferSelect;
