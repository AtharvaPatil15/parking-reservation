import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'accent';

/*
 * A badge always states STATUS or a category, never an action — so none of these
 * tones may be amber. Amber means "you can act here", and a tag is not something
 * you act on; an amber badge beside an amber button makes neither mean anything.
 *
 * `primary` was amber-tinted and carried SUBMITTED, "Inside" at the gate, and
 * role/allocation labels — all of them status. It now takes the navy chrome as a
 * FILLED tag; `accent` is the same navy as an OUTLINED tag. Several call sites
 * use the pair to tell two categories apart (company vs common-pool allocation,
 * SECURITY vs other roles), so the two must stay visually distinct while both
 * staying factual — filled/outlined does that without spending a second hue.
 */
const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-text-muted',
  primary: 'bg-field/[0.10] text-field dark:bg-field-ink/[0.16] dark:text-text',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
  accent: 'border border-border-strong bg-transparent text-text-muted',
};

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

/** Small status tag — square and tinted from the ramps, never a rounded pill. */
export function Badge({ tone = 'neutral', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        // A transparent border on every tone so the outlined `accent` variant is not a pixel
        // taller than the filled ones sitting beside it in the same table row.
        'inline-flex items-center border border-transparent px-2 py-0.5 text-xs tracking-[0.02em]',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
