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
        <thead className="bg-surface-2 text-xs uppercase tracking-wide text-text-muted">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={cn('px-6 py-3 font-medium', alignClass(col.align))}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-6 py-10">
                {empty ?? <p className="text-center text-sm text-text-muted">No data.</p>}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className={cn('border-t border-border', rowClassName?.(row))}>
                {columns.map((col) => (
                  <td key={col.key} className={cn('px-6 py-3', alignClass(col.align), col.className)}>
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
