import type { ElementType, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface BlueprintProps {
  children?: ReactNode;
  className?: string;
  /** Element to render as — sections and dialogs both wear the frame. */
  as?: ElementType;
}

/**
 * The frame every framed object wears: a hairline border. The body takes no fill
 * of its own — `Card` supplies the white.
 *
 * This used to also draw four `+` registration marks just outside the corners, as
 * a nod to a drawing sheet. They were dropped: at panel density they read as
 * stray glyphs floating between cards rather than as part of any panel, they
 * never quite aligned between two panels sitting side by side, and the border
 * alone already says "this is a bounded object".
 */
export function Blueprint({ children, className, as: Tag = 'div' }: BlueprintProps) {
  return <Tag className={cn('relative border border-border', className)}>{children}</Tag>;
}
