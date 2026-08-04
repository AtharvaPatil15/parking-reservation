import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Max-width of the dialog panel. */
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

/**
 * Accessible modal dialog rendered in a portal. Closes on Escape and backdrop
 * click, locks body scroll while open, and moves focus into the panel.
 */
export function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the dialog for keyboard/screen-reader users.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      // Only restore focus if the opener is still in the document. A row's Details button is
      // unmounted by paging/filtering/refetch, and focusing a detached node silently drops
      // focus to <body>, losing the keyboard user's place.
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          // Lay the panel out as a column so a long body scrolls internally, and cap it to the
          // parent's height (the parent is inset-0, i.e. the viewport, minus its own p-4) so the
          // header and footer stay reachable on a short/mobile screen. max-h-full needs no dvh
          // support, so there is nothing to fall back from.
          'relative flex max-h-full w-full flex-col rounded-card border border-border bg-surface shadow-pop outline-none',
          sizeClasses[size],
        )}
      >
        {title && (
          <div className="shrink-0 border-b border-border px-4 py-4 sm:px-6">
            <h2 id={titleId} className="break-words text-base font-semibold tracking-tight text-text">
              {title}
            </h2>
          </div>
        )}
        {/* min-h-0 lets this shrink below its content, which is what makes overflow-y-auto engage
            inside a flex column and keeps the header and footer reachable. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">{children}</div>
        {footer && (
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border px-4 py-4 sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
