import { cn } from '../lib/cn';
import type { components } from '../api/types';

type SlotBox = components['schemas']['SlotBox'];

export interface SlotCountProps {
  /** The date's slot boxes, straight from `DayAvailability.boxes` — counted here, never drawn. */
  boxes: SlotBox[];
  /** Compact rendering for inline use (e.g. a date row) rather than the main booking panel. */
  size?: 'sm' | 'md';
  className?: string;
}

interface SlotTally {
  filled: number;
  empty: number;
  blocked: number;
  total: number;
}

/**
 * Reduce a date's boxes to the three numbers that describe it. TAKEN and MINE are both "filled" —
 * from a capacity point of view someone has the slot either way, and whose it is belongs to the row's
 * own status badge, not to a count.
 */
function tallySlots(boxes: SlotBox[]): SlotTally {
  let filled = 0;
  let empty = 0;
  let blocked = 0;
  for (const box of boxes) {
    if (box.state === 'AVAILABLE') empty += 1;
    else if (box.state === 'BLOCKED') blocked += 1;
    else filled += 1;
  }
  return { filled, empty, blocked, total: boxes.length };
}

/**
 * How full a date is, as counts rather than a grid of boxes. Replaces the old per-slot rectangles:
 * the question a booker actually asks is "how many are left?", and twelve squares made them count.
 *
 * While a date is still `OPEN` this correctly reads `0 filled` — a request is a queue entry, not a
 * reservation (D18/D22), so nothing is filled until the weekly run decides. Demand for an open date is
 * reported separately by the caller, so a low "filled" is never mistaken for a free-for-all.
 *
 * Blocked slots are named only when there are any: they are neither filled nor empty, so leaving them
 * out silently would stop the numbers adding up to the company's quota.
 */
export function SlotCount({ boxes, size = 'md', className }: SlotCountProps) {
  const { filled, empty, blocked, total } = tallySlots(boxes);

  if (total === 0) {
    return (
      <p className={cn('text-text-muted', size === 'sm' ? 'text-xs' : 'text-sm', className)}>
        No slots are allotted to your company for this date.
      </p>
    );
  }

  // Spoken as one sentence: the visible "·" separators read as noise on a screen reader, and "8 / 12"
  // would be announced as a fraction.
  const spoken =
    `${filled} of ${total} slot${total === 1 ? '' : 's'} filled, ${empty} empty` +
    (blocked > 0 ? `, ${blocked} blocked` : '');

  return (
    <p
      className={cn(
        'flex flex-wrap items-baseline gap-x-1.5 whitespace-nowrap text-text-muted',
        size === 'sm' ? 'text-xs' : 'text-sm',
        className,
      )}
    >
      <span className="sr-only">{spoken}</span>
      <span aria-hidden="true" className="flex flex-wrap items-baseline gap-x-1.5">
        <span>
          <span className="font-medium tabular-nums text-text">{filled}</span> filled
        </span>
        <span className="text-border">·</span>
        <span>
          <span className="font-medium tabular-nums text-text">{empty}</span> empty
        </span>
        {blocked > 0 && (
          <>
            <span className="text-border">·</span>
            <span>
              <span className="font-medium tabular-nums">{blocked}</span> blocked
            </span>
          </>
        )}
      </span>
    </p>
  );
}
