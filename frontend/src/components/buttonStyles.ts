import { cn } from '../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const base =
  'inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-hover',
  secondary: 'border border-border bg-surface text-text hover:bg-surface-2',
  ghost: 'text-primary hover:bg-primary-subtle',
  danger: 'bg-danger text-white hover:opacity-90',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
};

/**
 * Button styling for something that is not a `<button>` — in practice a react-router `<Link>` that
 * should read as a button. Wrapping a `<Button>` in a `<Link>` instead nests `<button>` inside `<a>`,
 * which is invalid HTML and confuses screen readers and keyboard users.
 *
 * Lives apart from `Button.tsx` so that file only exports a component (react-refresh).
 */
export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cn(base, variantClasses[variant], sizeClasses[size], className);
}
