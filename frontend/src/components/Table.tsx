import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { useMediaQuery } from '../lib/useMediaQuery';

export interface Column<T> {
  /** Stable key for the column. */
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
  /**
   * Stacked (narrow) layout only: render this cell without its column label.
   * Use for the row's identity column and for action buttons, where a label
   * would just be noise.
   */
  stackedBare?: boolean;
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

/**
 * Generic, presentational data table driven by a column config.
 *
 * Two layouts from one config, and only ever ONE of them in the DOM. From 768px up
 * it is a real `<table>`. Below that each row becomes a stacked label/value card,
 * because the horizontally-scrolled table hid exactly the columns that mattered on
 * a phone — the status pill was sliced in half and the Approve / Reject / Details
 * buttons were off-screen entirely, with nothing to suggest they existed. Stacking
 * means no cell is unreachable at 390px.
 *
 * Rendering both layouts and hiding one with CSS would be simpler, but it puts every
 * cell in the DOM twice, so a screen reader announces each row twice.
 */
export function Table<T>({ columns, rows, rowKey, rowClassName, empty, className }: TableProps<T>) {
  const alignClass = (align?: 'left' | 'right') => (align === 'right' ? 'text-right' : 'text-left');
  const isEmpty = rows.length === 0;
  const isWide = useMediaQuery('(min-width: 768px)');
  const emptyBlock = empty ?? <p className="text-center text-sm text-text-muted">No data.</p>;

  if (!isWide) {
    return (
      <div className={className}>
        <ul>
          {isEmpty ? (
            <li className="px-4 py-10">{emptyBlock}</li>
          ) : (
            rows.map((row) => (
              <li
                key={rowKey(row)}
                className={cn('flex flex-col gap-2 border-b border-border/50 px-4 py-3.5', rowClassName?.(row))}
              >
                {columns.map((col) => {
                  const cell = col.render(row);
                  // A bare cell (identity, actions) carries no label; skip it when empty
                  // so an action-less row doesn't leave a blank line.
                  if (col.stackedBare) {
                    return cell ? <div key={col.key}>{cell}</div> : null;
                  }
                  return (
                    <div key={col.key} className="flex items-baseline justify-between gap-3">
                      <span className="shrink-0 font-mono text-3xs uppercase tracking-[0.11em] text-text-muted">
                        {col.header}
                      </span>
                      {/* `flex justify-end` as well as `text-right`: text-align only moves inline
                          content, so a cell whose render returns a flex/block child (e.g. a wrapped
                          list of chips) packed to the LEFT of a right-aligned column and read as a
                          broken fragment. This aligns both kinds of content the same way. */}
                      <span
                        className={cn(
                          'flex min-w-0 flex-col items-end gap-1 text-right text-sm',
                          col.className,
                        )}
                      >
                        {cell}
                      </span>
                    </div>
                  );
                })}
              </li>
            ))
          )}
        </ul>
      </div>
    );
  }

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
          {isEmpty ? (
            <tr>
              <td colSpan={columns.length} className="px-3.5 py-10">
                {emptyBlock}
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
