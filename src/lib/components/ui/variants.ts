import { tv, type VariantProps } from 'tailwind-variants';

export const button = tv({
	base: [
		'inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap select-none',
		'transition-colors duration-150',
		'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none dark:focus-visible:ring-offset-zinc-950',
		'disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0'
	],
	variants: {
		variant: {
			primary: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover',
			secondary:
				'bg-zinc-100 text-zinc-900 hover:bg-zinc-200/80 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/80',
			outline:
				'border border-zinc-200 bg-white text-zinc-700 shadow-xs hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:text-white',
			ghost:
				'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100',
			danger: 'bg-danger text-danger-foreground shadow-xs hover:bg-danger-hover',
			'danger-ghost': 'text-danger hover:bg-danger/10',
			success: 'bg-success text-white shadow-xs hover:bg-success/90'
		},
		size: {
			xs: 'h-7 rounded-md px-2 text-xs [&_svg]:size-3.5',
			sm: 'h-8 px-3 text-sm',
			md: 'h-9 px-4 text-sm',
			lg: 'h-11 px-5 text-base',
			icon: 'size-9',
			'icon-sm': 'size-8 rounded-md',
			'icon-xs': 'size-7 rounded-md [&_svg]:size-3.5'
		}
	},
	defaultVariants: { variant: 'outline', size: 'md' }
});
export type ButtonVariants = VariantProps<typeof button>;

export const badge = tv({
	base: [
		'inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3',
		'dark:border-zinc-800 dark:bg-zinc-900'
	],
	variants: {
		tone: {
			neutral: 'text-zinc-600 dark:text-zinc-400',
			success: 'text-zinc-700 dark:text-zinc-300',
			warning: 'text-warning',
			danger: 'border-danger/30 text-danger',
			info: 'border-primary/30 text-link',
			violet: 'text-zinc-700 dark:text-zinc-300'
		}
	},
	defaultVariants: { tone: 'neutral' }
});
export type BadgeVariants = VariantProps<typeof badge>;

export const card = tv({
	slots: {
		root: 'rounded-lg border border-zinc-200 bg-white shadow-xs dark:border-zinc-800/80 dark:bg-zinc-900/60',
		header:
			'flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800/80',
		title: 'text-sm font-semibold text-zinc-900 dark:text-zinc-100',
		description: 'text-xs text-zinc-500 dark:text-zinc-400',
		body: 'p-5'
	},
	variants: {
		flush: { true: { body: 'p-0' } },
		interactive: {
			true: {
				root: 'transition-colors hover:border-zinc-300 dark:hover:border-zinc-700'
			}
		}
	}
});

export const input = tv({
	base: [
		'w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 shadow-xs placeholder:text-zinc-400',
		'transition-colors focus:border-ring focus:ring-3 focus:ring-ring/20 focus:outline-none',
		'disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger aria-invalid:focus:ring-danger/15',
		'dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500'
	],
	variants: {
		size: { sm: 'h-8 text-xs', md: 'h-9', lg: 'h-11' },
		mono: { true: 'font-mono text-[13px]' },
		multiline: { true: 'h-auto py-2' }
	},
	defaultVariants: { size: 'md' }
});

export const statusDot = tv({
	base: 'relative inline-flex size-2 shrink-0 rounded-full',
	variants: {
		tone: {
			running: 'bg-success',
			partial: 'bg-warning',
			unhealthy: 'bg-danger',
			stopped: 'bg-zinc-400 dark:bg-zinc-600',
			'not-deployed':
				'bg-zinc-300 ring-1 ring-zinc-400 ring-inset dark:bg-transparent dark:ring-zinc-600',
			busy: 'bg-primary'
		},
		pulse: {
			true: 'after:absolute after:inset-0 after:animate-ping after:rounded-full after:bg-inherit after:opacity-60'
		}
	}
});
