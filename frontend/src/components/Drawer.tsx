import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
}

/**
 * Accessible left-side slide-out drawer rendered in a portal. Closes on Escape
 * and backdrop click, locks body scroll while open, and moves focus into the panel.
 */
export function Drawer({ open, onClose, title, children }: DrawerProps) {
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

    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Navigation'}
        tabIndex={-1}
        className="absolute inset-y-0 left-0 flex w-64 max-w-[80vw] flex-col border-r border-border bg-surface shadow-pop outline-none"
      >
        {title && (
          <div className="border-b border-border px-4 py-4">
            <h2 id={titleId} className="text-base font-semibold tracking-tight text-text">
              {title}
            </h2>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-2">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
