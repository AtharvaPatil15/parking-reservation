import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Which edge the panel slides in from. */
  side?: 'right' | 'left';
  /**
   * `nav` — narrow menu panel for the top-bar hamburger (tight padding, link list).
   * `sheet` — wide panel for a form with its own actions (roomy padding, footer row).
   */
  variant?: 'sheet' | 'nav';
}

/**
 * Edge-anchored slide-out panel, sharing `Modal`'s accessibility behaviour (portal, Escape, backdrop
 * click, body scroll lock, focus move + restore) but laid out full-height against one side.
 *
 * Two presets rather than two components: the app-shell navigation drawer and the security gate sheet
 * differ only in width and padding, and duplicating the focus/scroll/Escape handling to express that
 * would mean two places to get accessibility wrong.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  side = 'right',
  variant = 'sheet',
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

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

  const isNav = variant === 'nav';

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        // An untitled nav panel still needs a name for screen readers.
        aria-label={!title && isNav ? 'Navigation' : undefined}
        tabIndex={-1}
        className={cn(
          'absolute inset-y-0 flex flex-col border-border bg-surface shadow-pop outline-none',
          isNav ? 'w-64 max-w-[80vw]' : 'w-full max-w-md',
          side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
        )}
      >
        {(title || description) && (
          <div className={cn('space-y-1 border-b border-border', isNav ? 'px-4 py-4' : 'px-6 py-4')}>
            {title && (
              <h2 id={titleId} className="text-base font-semibold tracking-tight text-text">
                {title}
              </h2>
            )}
            {description && (
              <p id={descId} className="text-sm text-text-muted">
                {description}
              </p>
            )}
          </div>
        )}
        {/* The body scrolls, so a long list never pushes the footer actions off-screen. */}
        <div className={cn('flex-1 overflow-y-auto', isNav ? 'p-2' : 'px-6 py-5')}>{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
