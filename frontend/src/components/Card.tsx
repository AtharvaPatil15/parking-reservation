import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Blueprint } from './Blueprint';

export interface CardProps {
  title?: ReactNode;
  description?: ReactNode;
  /** Rendered on the right of the header (e.g. an action button). */
  actions?: ReactNode;
  /** Monospace meta line on the right of the header (e.g. "47 requests · 31 allocated"). */
  meta?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Set false to remove body padding (e.g. when embedding a full-bleed table). */
  padded?: boolean;
}

/**
 * A framed blueprint object with an optional header (title/description/actions).
 *
 * Transparent by design — in this system a card is a line drawing, not a filled
 * surface, so it takes the frame and the registration marks instead of a fill.
 */
export function Card({ title, description, actions, meta, children, className, padded = true }: CardProps) {
  const hasHeader = title || description || actions || meta;
  return (
    <Blueprint as="section" className={cn('bg-transparent', className)}>
      {hasHeader && (
        <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-2.5">
          <div className="space-y-0.5">
            {title && <h2 className="text-lg text-text">{title}</h2>}
            {description && <p className="text-sm text-text-muted">{description}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {meta && (
              <span className="font-mono text-2xs uppercase tracking-[0.1em] text-text-muted">{meta}</span>
            )}
            {actions}
          </div>
        </div>
      )}
      {children && <div className={cn(padded && 'p-4')}>{children}</div>}
    </Blueprint>
  );
}
