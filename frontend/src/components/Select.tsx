import { forwardRef, useId, type SelectHTMLAttributes } from 'react';
import { cn } from '../lib/cn';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
}

/** Labelled native select — same label/hint/error/a11y contract as Input. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, options, placeholder, id, className, value, defaultValue, ...rest },
  ref,
) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const describedById = error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined;
  // When a placeholder is set and the caller hasn't opted into controlled
  // (`value`) or uncontrolled (`defaultValue`) selection, default to the
  // placeholder's empty value so browsers don't auto-select the first real
  // option and hide the placeholder.
  const uncontrolledDefaultValue =
    placeholder && value === undefined && defaultValue === undefined ? '' : defaultValue;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={selectId} className="text-sm font-medium text-text">
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedById}
        className={cn(
          'h-10 w-full rounded-control border bg-surface px-3 text-sm text-text transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-60',
          error ? 'border-danger' : 'border-border hover:border-text-muted',
          className,
        )}
        value={value}
        defaultValue={uncontrolledDefaultValue}
        {...rest}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error ? (
        <p id={`${selectId}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${selectId}-hint`} className="text-sm text-text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
