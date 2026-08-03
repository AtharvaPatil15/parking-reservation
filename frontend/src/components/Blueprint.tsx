import type { ElementType, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface BlueprintProps {
  children?: ReactNode;
  className?: string;
  /** Element to render as — sections and dialogs both wear the frame. */
  as?: ElementType;
  /** Drop the corner marks (e.g. for a nested frame, where they'd collide). */
  marks?: boolean;
}

/**
 * The wireframe frame every framed object wears in the Industry system: a
 * transparent body, a hairline border and four `+` registration marks drawn
 * just outside the corners.
 *
 * Purely presentational — the marks are aria-hidden, so screen readers and
 * test queries see only the children.
 */
export function Blueprint({ children, className, as: Tag = 'div', marks = true }: BlueprintProps) {
  return (
    <Tag className={cn('relative border border-border', className)}>
      {marks && <BlueprintMarks />}
      {children}
    </Tag>
  );
}

/**
 * The four corner marks on their own, for callers that already have a bordered
 * box and only need the registration crosses.
 */
export function BlueprintMarks() {
  return (
    <>
      <Corner className="-left-1.5 -top-1.5" />
      <Corner className="-right-1.5 -top-1.5" />
      <Corner className="-bottom-1.5 -left-1.5" />
      <Corner className="-bottom-1.5 -right-1.5" />
    </>
  );
}

/** One `+` mark: an 11px box with a hairline cross through its centre. */
function Corner({ className }: { className: string }) {
  return (
    <span aria-hidden="true" className={cn('pointer-events-none absolute h-[11px] w-[11px] text-text-muted', className)}>
      <span className="absolute left-[5px] top-0 h-full w-px bg-current" />
      <span className="absolute left-0 top-[5px] h-px w-full bg-current" />
    </span>
  );
}
