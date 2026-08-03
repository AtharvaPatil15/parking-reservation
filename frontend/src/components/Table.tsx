import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface Column<T> {
  /** Stable key for the column. */
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

export interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Optional per-row class (e.g. to highlight the winning allocation row). */
  rowClassName?: (row: T) => string | undefined;
  /** Shown in place of the body when there are no rows. */
  empty?: ReactNode;
  className?: string;
}

/** Generic, presentational data table driven by a column config. */
export function Table<T>({ columns, rows, rowKey, rowClassName, empty, className }: TableProps<T>) {
  const alignClass = (align?: 'left' | 'right') => (align === 'right' ? 'text-right' : 'text-left');

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-left text-sm">
        {/* Headers are monospace and letterspaced — the system reads them as
            spec-sheet column labels rather than as prose. */}
        <thead className="font-mono text-3xs uppercase tracking-[0.11em] text-text-muted">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn('border-b border-border px-3.5 py-2.5 font-normal', alignClass(col.align))}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3.5 py-10">
                {empty ?? <p className="text-center text-sm text-text-muted">No data.</p>}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={cn(
                  'border-b border-border/50 transition-colors hover:bg-surface-2/60',
                  rowClassName?.(row),
                )}
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn('px-3.5 py-2.5', alignClass(col.align), col.className)}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
