import type { ReactNode } from 'react';
import { Card } from '../../components';

export interface Stat {
  label: string;
  value: ReactNode;
  hint?: string;
}

/** Responsive grid of headline metric tiles, shared by the admin dashboards. */
export function StatTiles({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((s) => (
        <Card key={s.label}>
          <div className="space-y-1">
            <p className="text-sm text-text-muted">{s.label}</p>
            <p className="text-2xl font-semibold tabular-nums text-text">{s.value}</p>
            {s.hint && <p className="text-xs text-text-muted">{s.hint}</p>}
          </div>
        </Card>
      ))}
    </div>
  );
}
