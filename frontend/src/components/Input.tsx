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
          'h-[34px] w-full rounded-control border bg-surface-2 px-2.5 text-sm text-text caret-primary placeholder:text-text-muted transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-45',
          error ? 'border-danger' : 'border-border hover:border-text-muted',
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
