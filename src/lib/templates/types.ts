import type { Component } from 'svelte';

/**
 * A template creates a new project: it generates the compose file from the
 * values of its config form. It can also add tabs to other projects, e.g. the
 * Caddy template adds the Domains tab once a Caddy project exists. Which tabs
 * apply to a project is decided on the server (see `#lib/server/templates`).
 */
export interface TemplateTab {
	id: string;
	label: string;
	icon: Component;
	/** rendered as tab content, gets the project (folder) name */
	component: Component<{ name: string }>;
}

export interface Template<V extends object = object> {
	id: string;
	name: string;
	description: string;
	icon: Component;
	/** short label for the badge on matching projects */
	badge: string;
	/** suggested project name */
	defaultName: string;
	/** initial values of the config form */
	defaults: () => V;
	/** config form, `values` is bindable */
	form: Component<{ values: V }, object, 'values'>;
	/** tabs this template can add to other projects */
	tabs?: TemplateTab[];
}

/** Tab a template adds to a specific project (computed on the server). */
export interface ProjectTab {
	template: string;
	id: string;
	count?: number;
}
