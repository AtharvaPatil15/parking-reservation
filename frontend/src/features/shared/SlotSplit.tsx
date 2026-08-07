import { Blueprint } from '../../components';
import { cn } from '../../lib/cn';

export interface SlotSplitProps {
  total: number | undefined;
  booked: number | undefined;
  /** Omit where the scope has no common pool (a single company's quota). */
  pool?: number | undefined;
  blocked: number | undefined;
  free: number | undefined;
  /** Heading noun — "slots" app-wide, but callers may scope it ("your slots"). */
  label?: string;
  className?: string;
}

/**
 * Where the day's slots went: a stacked occupancy bar over a legend of counts and
 * shares. The utilization figure itself lives in the metric plate, so it is not
 * repeated here.
 *
 * Every number is passed in from a dashboard payload — this component derives only
 * the percentages, so it never implies data the API didn't return.
 */
export function SlotSplit({
  total,
  booked,
  pool,
  blocked,
  free,
  label,
  className,
}: SlotSplitProps) {
  const sum = total ?? 0;
  /**
   * Fills are ordered so the bar always reads full → empty, in both themes.
   *
   * `bg-primary` alone did not survive dark mode: there the accent is a PALE blue,
   * so "Booked" became the lightest segment and the ramp ran backwards, while
   * Blocked and Free (a subtle fill and no fill) both disappeared into the track.
   * Opacity steps off the ink colour keep the ordering regardless of which way the
   * palette flips, and Free carries a hairline so it reads as a segment, not a gap.
   */
  const rows = [
    { key: 'Booked', n: booked ?? 0, fill: 'bg-primary', swatch: 'bg-primary' },
    ...(pool == null
      ? []
      : [{ key: 'Common pool', n: pool, fill: 'bg-primary/55', swatch: 'bg-primary/55' }]),
    { key: 'Blocked', n: blocked ?? 0, fill: 'bg-text/25', swatch: 'bg-text/25' },
    { key: 'Free', n: free ?? 0, fill: 'bg-text/[0.06]', swatch: 'bg-text/[0.06]' },
  ];
  // Widths use the exact share; only the printed label rounds. Rounding the width
  // let a small non-zero category collapse to 0% and disappear from the bar, which
  // misrepresented the counts it exists to show.
  const shareExact = (n: number) => (sum > 0 ? (n / sum) * 100 : 0);
  const share = (n: number) => Math.round(shareExact(n));

  return (
    <Blueprint className={cn('flex flex-col p-4', className)}>
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <h2 className="text-lg">Where the {sum.toLocaleString()} {label ?? 'slots'} went</h2>
        <span className="font-mono text-3xs uppercase tracking-[0.1em] text-text-muted">Today</span>
      </div>

      {/* The bar: one segment per row, hairline-separated, framed like a figure. */}
      <div className="mb-3 flex h-[26px] border border-border" role="img" aria-label={rows.map((r) => `${r.key} ${r.n}`).join(', ')}>
        {rows.map((r) => (
          <span
            key={r.key}
            className={`${r.fill} block border-r border-canvas last:border-r-0`}
            style={{ width: `${shareExact(r.n)}%` }}
          />
        ))}
      </div>

      <div className="flex flex-col">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2.5 border-b border-border/50 py-1.5">
            <span aria-hidden="true" className={`${r.fill} h-[11px] w-[11px] shrink-0 border border-border`} />
            <span className="flex-1 text-sm">{r.key}</span>
            <span className="text-sm tabular-nums">{r.n.toLocaleString()}</span>
            <span className="w-10 text-right text-xs tabular-nums text-text-muted">{share(r.n)}%</span>
          </div>
        ))}
      </div>

    </Blueprint>
  );
}
