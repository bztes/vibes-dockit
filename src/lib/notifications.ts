// Shared (client + server) notification definitions.

export const EVENT_TYPES = [
	{
		id: 'update_available',
		label: 'Update available',
		description: 'A newer image was found in the registry'
	},
	{ id: 'update_success', label: 'Update installed', description: 'A project was updated' },
	{ id: 'update_failed', label: 'Update failed', description: 'Pulling or recreating failed' },
	{
		id: 'container_died',
		label: 'Container crashed',
		description: 'A container exited unexpectedly'
	},
	{
		id: 'container_unhealthy',
		label: 'Container unhealthy',
		description: 'A health check started failing'
	},
	{
		id: 'action_failed',
		label: 'Action failed',
		description: 'start / stop / deploy failed'
	}
] as const;

export type EventType = (typeof EVENT_TYPES)[number]['id'];
export const EVENT_IDS = EVENT_TYPES.map((e) => e.id) as [EventType, ...EventType[]];

export const CHANNEL_TYPES = ['ntfy', 'email', 'webhook'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export interface NtfyConfig {
	server: string;
	topic: string;
	token?: string;
	priority?: number;
}
/** Per user: only the recipients. The SMTP server is global (see SmtpSettings). */
export interface EmailConfig {
	to: string;
}
/** Global, admin managed SMTP server used by all email channels. */
export interface SmtpSettings {
	host: string;
	port: number;
	secure: boolean;
	username?: string;
	password?: string;
	from: string;
}
export interface WebhookConfig {
	url: string;
	headers?: string;
}

export type Channel = {
	id: string;
	name: string;
	enabled: boolean;
	events: EventType[];
	/** folder names; empty = all projects */
	projects: string[];
} & (
	| { type: 'ntfy'; config: NtfyConfig }
	| { type: 'email'; config: EmailConfig }
	| { type: 'webhook'; config: WebhookConfig }
);
