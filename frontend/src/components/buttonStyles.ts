import { cn } from '../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

/*
 * The single definition of button styling, shared by `Button.tsx` and by
 * `buttonClasses()` below. These two used to carry their own copies and had
 * drifted apart — different heights (h-10 vs h-[34px]), different disabled
 * treatment, and this file still hardcoded `text-white` — so a Link styled as a
 * button did not match a real button beside it. One source now.
 *
 * Buttons take the condensed heading face: in this system they read as labels
 * stamped on the board, not as body text.
 */

// Disabled drops the fill entirely rather than just fading it: a 45%-opacity
// filled button still reads as a slightly paler filled button, so "unavailable"
// and "primary action" looked the same. Losing the fill is categorical.
export const buttonBase =
  'inline-flex items-center justify-center gap-1.5 rounded-control border font-heading font-semibold tracking-[0.01em] transition-colors disabled:cursor-not-allowed disabled:border-border disabled:!bg-transparent disabled:text-text-muted';

/*
 * Amber is the action colour and it appears once per screen region. Only ONE
 * primary button should be visible on a screen — if two actions feel equally
 * important, one of them isn't.
 *
 * `danger` is deliberately not a red fill: a filled red button is as loud as the
 * primary and competes with it, and red is a status role here (blocked), not an
 * action role. Destructive actions are text + a tint on hover, which reads as
 * "available, consequential" rather than "the thing to do next".
 */
export const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'border-primary bg-primary text-primary-ink hover:border-primary-hover hover:bg-primary-hover active:border-primary-active active:bg-primary-active',
  // border-strong, not the hairline: this is a control edge and must clear 3:1.
  secondary: 'border-border-strong bg-surface text-text hover:bg-surface-2',
  ghost: 'border-transparent bg-transparent text-accent hover:text-primary-hover hover:underline',
  danger: 'border-transparent bg-transparent text-danger hover:bg-danger-subtle',
};

export const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-[30px] px-3 text-sm',
  md: 'h-[34px] px-4 text-sm',
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
  return cn(buttonBase, buttonVariants[variant], buttonSizes[size], className);
}
