import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/cn';
import { Spinner } from './Spinner';
import {
  buttonBase,
  buttonSizes,
  buttonVariants,
  type ButtonSize,
  type ButtonVariant,
} from './buttonStyles';

export type { ButtonSize, ButtonVariant };

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
      className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});
