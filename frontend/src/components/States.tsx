import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Spinner } from './Spinner';

/**
 * The four canonical async view states, used app-wide so loading/empty/error/success
 * look consistent everywhere. Each centers within its container.
 */

function StateShell({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}>
      {children}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <StateShell>
      <Spinner className="text-primary" />
      <p className="text-sm text-text-muted">{label}</p>
    </StateShell>
  );
}

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <StateShell>
      {icon && <div className="text-text-muted">{icon}</div>}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-text">{title}</p>
        {description && <p className="max-w-sm text-sm text-text-muted">{description}</p>}
      </div>
      {action}
    </StateShell>
  );
}

export interface ErrorStateProps {
  title?: string;
  description?: string;
  action?: ReactNode;
}

export function ErrorState({
  title = 'Something went wrong',
  description = 'Please try again.',
  action,
}: ErrorStateProps) {
  return (
    <StateShell>
      <div className="grid h-9 w-9 place-items-center border border-danger bg-danger-subtle font-heading text-lg text-danger">
        !
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-text">{title}</p>
        <p className="max-w-sm text-sm text-text-muted">{description}</p>
      </div>
      {action}
    </StateShell>
  );
}

export interface SuccessStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function SuccessState({ title, description, action }: SuccessStateProps) {
  return (
    <StateShell>
      <div className="grid h-9 w-9 place-items-center border border-success bg-success-subtle text-lg text-success">
        ✓
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-text">{title}</p>
        {description && <p className="max-w-sm text-sm text-text-muted">{description}</p>}
      </div>
      {action}
    </StateShell>
  );
}
