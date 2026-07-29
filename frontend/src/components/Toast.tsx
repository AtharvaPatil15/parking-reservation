import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

interface Toast {
  id: number;
  tone: ToastTone;
  message: ReactNode;
}

export interface ToastOptions {
  tone?: ToastTone;
  /** Auto-dismiss delay in ms. Defaults to 4000; pass 0 to keep it until dismissed. */
  duration?: number;
}

interface ToastContextValue {
  toast: (message: ReactNode, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const toneClasses: Record<ToastTone, string> = {
  info: 'border-primary/30 bg-surface text-text',
  success: 'border-success/30 bg-success-subtle text-text',
  warning: 'border-warning/30 bg-warning-subtle text-text',
  danger: 'border-danger/30 bg-danger-subtle text-text',
};

const toneAccent: Record<ToastTone, string> = {
  info: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

/** Provides the `useToast` hook and renders the toast stack in a portal. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  // Typed as `number` (not `ReturnType<typeof window.setTimeout>`) because that
  // helper resolves to the last overload of the ambient `setTimeout` — which
  // is `@types/node`'s `NodeJS.Timeout` — while calling `window.setTimeout`
  // in the browser actually returns a number.
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: ReactNode, options?: ToastOptions) => {
      const id = nextId.current++;
      const tone = options?.tone ?? 'info';
      const duration = options?.duration ?? 4000;
      setToasts((current) => [...current, { id, tone, message }]);
      if (duration > 0) {
        const timer = window.setTimeout(() => dismiss(id), duration);
        timers.current.set(id, timer);
      }
    },
    [dismiss],
  );

  // Clear any pending auto-dismiss timers on unmount to avoid state updates
  // firing after the provider is gone.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer));
      pending.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {createPortal(
        <div className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2" aria-live="polite">
          {toasts.map((t) => (
            <div
              key={t.id}
              role="status"
              className={cn(
                'flex items-start gap-3 overflow-hidden rounded-card border pl-0 pr-3 py-3 shadow-pop',
                toneClasses[t.tone],
              )}
            >
              <span className={cn('h-full w-1 self-stretch rounded-full', toneAccent[t.tone])} aria-hidden="true" />
              <p className="flex-1 text-sm">{t.message}</p>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="text-text-muted transition-colors hover:text-text"
              >
                ✕
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
