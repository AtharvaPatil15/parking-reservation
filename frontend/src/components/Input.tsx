import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from '../lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Helper text shown below the field when there's no error. */
  hint?: string;
  /** Error message; when set, the field is marked invalid and styled accordingly. */
  error?: string;
  /**
   * Keep the hint/error line's height even when there is no message. Set this on the *unhinted*
   * fields of a `flex items-end` row so a hinted neighbour doesn't sit taller and knock every
   * input out of line. Off by default: in a normal stacked form the extra gap is unwanted.
   */
  hintReserve?: boolean;
}

/**
 * Labelled text input with hint/error support. Wires up label htmlFor,
 * aria-invalid and aria-describedby so it's accessible by default.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, hintReserve = false, id, className, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedById = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label
          htmlFor={inputId}
          className="text-2xs uppercase tracking-[0.1em] text-text-muted"
        >
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedById}
        className={cn(
          // The field is a sunken plane inside a white card, so its edge is border-STRONG: as a UI
          // boundary it must clear 3:1, which the hairline does not. Focus takes the amber border
          // plus a soft amber halo rather than the global ring, so the field itself lights up.
          'h-[34px] w-full rounded-control border bg-surface-2 px-2.5 text-sm text-text caret-primary placeholder:text-text-muted transition-colors',
          'focus:outline-none focus:ring-[3px] focus:ring-accent-focus/25',
          'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-muted disabled:opacity-100',
          error
            ? 'border-danger focus:border-danger focus:ring-danger/20'
            : 'border-border-strong hover:border-text-muted focus:border-primary',
          className,
        )}
        {...rest}
      />
      {error ? (
        <p id={`${inputId}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-xs text-text-muted">
          {hint}
        </p>
      ) : hintReserve ? (
        <p aria-hidden="true" className="text-sm">
          &nbsp;
        </p>
      ) : null}
    </div>
  );
});
