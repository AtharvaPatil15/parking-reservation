import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface CardProps {
  title?: ReactNode;
  description?: ReactNode;
  /** Rendered on the right of the header (e.g. an action button). */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Set false to remove body padding (e.g. when embedding a full-bleed table). */
  padded?: boolean;
}

/** Surface container with an optional header (title/description/actions). */
export function Card({ title, description, actions, children, className, padded = true }: CardProps) {
  const hasHeader = title || description || actions;
  return (
    <section className={cn('overflow-hidden rounded-card border border-border bg-surface shadow-card', className)}>
      {hasHeader && (
        <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
          <div className="space-y-1">
            {title && <h2 className="text-base font-semibold tracking-tight text-text">{title}</h2>}
            {description && <p className="text-sm text-text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {/* Tighter inset on a phone; the sm+ inset is unchanged. Applied here rather than at each
          call site so a Card's header, body, table cells and pager all stay aligned. */}
      {children && <div className={cn(padded && 'p-4 sm:p-6')}>{children}</div>}
    </section>
  );
}
