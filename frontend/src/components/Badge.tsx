import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'accent';

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-text-muted',
  primary: 'bg-primary-subtle text-primary',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
  accent: 'bg-accent-subtle text-accent',
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
        'inline-flex items-center px-2 py-0.5 text-xs tracking-[0.02em]',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
