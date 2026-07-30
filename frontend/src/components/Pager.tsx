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
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 px-6 py-3 text-sm text-text-muted', className)}>
      <span className="tabular-nums">{total === 0 ? 'No results' : `${start}–${end} of ${total}`}</span>
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Prev
        </Button>
        <span className="tabular-nums">Page {page} / {lastPage}</span>
        <Button variant="secondary" size="sm" disabled={page >= lastPage} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
