import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

// Buttons take the condensed heading face — in this system they read as labels
// stamped on the board, not as body text.
const base =
  // Disabled drops the fill entirely rather than just fading it: a 45%-opacity
  // steel button still reads as a slightly paler steel button, so "unavailable"
  // and "primary action" looked the same. Losing the fill is categorical.
  'inline-flex items-center justify-center gap-1.5 rounded-control border font-heading font-semibold tracking-[0.01em] transition-colors disabled:cursor-not-allowed disabled:border-border disabled:!bg-transparent disabled:text-text-muted';

// The primary is the one solid object on an otherwise transparent board; every
// other variant stays a line drawing.
const variantClasses: Record<ButtonVariant, string> = {
  primary: 'border-primary bg-primary text-primary-ink hover:border-primary-hover hover:bg-primary-hover',
  secondary: 'border-border bg-transparent text-text hover:bg-surface-2',
  ghost: 'border-transparent bg-transparent text-primary hover:bg-primary-subtle',
  danger: 'border-danger bg-danger text-primary-ink hover:opacity-90',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-[30px] px-3 text-sm',
  md: 'h-[34px] px-4 text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables the button while true. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className, children, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      // Default to type="button" so a Button inside a form never submits by accident.
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(base, variantClasses[variant], sizeClasses[size], className)}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});
