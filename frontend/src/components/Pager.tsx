import { Button } from './Button';
import { cn } from '../lib/cn';

export interface PagerProps {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  className?: string;
}

/**
 * Shared list pager: a range/total summary plus Prev / "Page X / Y" / Next controls.
 * Buttons are always shown (disabled at the ends) so the navigation affordance is discoverable.
 */
export function Pager({ page, pageSize, total, onPage, className }: PagerProps) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  // A filter or refetch can shrink `total` while the caller is on a high page. Clamp for display
  // so the summary can't read "41-20 of 5", and so Prev steps back from a real page.
  const current = Math.min(Math.max(1, page), lastPage);
  const start = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const end = Math.min(current * pageSize, total);
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 text-sm text-text-muted sm:px-6', className)}>
      <span className="tabular-nums">{total === 0 ? 'No results' : `${start}–${end} of ${total}`}</span>
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" disabled={current <= 1} onClick={() => onPage(current - 1)}>
          Prev
        </Button>
        <span className="tabular-nums">Page {current} / {lastPage}</span>
        <Button variant="secondary" size="sm" disabled={current >= lastPage} onClick={() => onPage(current + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
