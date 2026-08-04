import type { ReactNode } from 'react';
import { Blueprint } from '../../components';

export interface Stat {
  label: string;
  value: ReactNode;
  hint?: string;
}

/**
 * Headline metrics as one drawn spec-sheet plate: a single framed grid of equal
 * cells sharing hairline rules, rather than a row of separate cards. Figures take
 * the condensed face at display size with tabular figures so columns align.
 */
export function StatTiles({ stats }: { stats: Stat[] }) {
  return (
    // A 1px gap over a border-coloured ground draws every internal rule at once,
    // so cell count and wrapping can't leave a stray or missing edge.
    // Capped: past ~1400px the 4-up grid gives each cell 600px to hold a short
    // label and one figure, which reads as lost rather than generous.
    <Blueprint className="grid max-w-[1400px] grid-cols-2 gap-px bg-border lg:grid-cols-4">
      {stats.map((s, i) => (
        <div key={s.label} className="bg-canvas px-3.5 py-3">
          {/* Numbered like a spec sheet: the index reads as a plate reference. */}
          <p className="font-mono text-3xs uppercase tracking-[0.14em] text-text-muted">
            <span className="text-primary">{String(i + 1).padStart(2, '0')}</span> · {s.label}
          </p>
          <p className="mt-1 font-heading text-3xl tabular-nums text-text">{s.value}</p>
          {s.hint && <p className="mt-0.5 text-xs text-text-muted">{s.hint}</p>}
        </div>
      ))}
    </Blueprint>
  );
}
