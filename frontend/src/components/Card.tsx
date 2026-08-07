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
 * Carries the white `--surface` fill against the near-white `--canvas` page.
 * That half-step is what makes a panel read as an object rather than as a
 * rectangle ruled onto the page — and it is load-bearing for contrast: amber
 * body text clears 4.5:1 on white but not on the page ground, so accent text
 * and links are only ever safe inside a card. Keep the fill.
 */
export function Card({ title, description, actions, meta, children, className, padded = true }: CardProps) {
  const hasHeader = title || description || actions || meta;
  return (
    <Blueprint as="section" className={cn('bg-surface', className)}>
      {/* Responsive inset (tighter on a phone) with the reskin's condensed
          heading — the base layer supplies the face and weight. */}
      {hasHeader && (
        <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-2.5 sm:px-6">
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
      {/* Tighter inset on a phone; the sm+ inset is unchanged. Applied here rather than at each
          call site so a Card's header, body, table cells and pager all stay aligned. */}
      {children && <div className={cn(padded && 'p-4 sm:p-6')}>{children}</div>}
    </Blueprint>
  );
}
