import { cn } from '../lib/cn';
import type { components } from '../api/types';

type SlotBox = components['schemas']['SlotBox'];
type BoxState = SlotBox['state'];
type DayAvailabilityPhase = components['schemas']['DayAvailabilityPhase'];

export interface SlotGridProps {
  boxes: SlotBox[];
  /**
   * Phase 8 (D22): `OPEN` (before the date's weekly run) never has TAKEN/MINE boxes to begin with, but
   * is accepted here too so the grid and its legend can be driven from the same prop consistently.
   */
  phase?: DayAvailabilityPhase;
  /** Compact rendering for inline use (e.g. a date picker row) rather than the main booking panel. */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * The parking-slot grid (§5.2, D22): one rectangle per slot of the company's quota — green when free,
 * grey when taken or blocked, highlighted when it is the viewer's own allocation. While `phase = OPEN`
 * the grid never contains a TAKEN or MINE box (requests are a queue, not a reservation — D18); once
 * `DECIDED`, MINE/TAKEN boxes render the real `slotNumber` instead of the grid position.
 *
 * Colour is never the only signal: each box carries a title/aria-label naming its state (and slot
 * number where applicable), so the grid is usable with a screen reader and for colour-blind viewers.
 */
// Both TAKEN and BLOCKED are grey per the requirement; BLOCKED gets a dashed edge so the two are
// still tellable apart without introducing another colour.
const STATE_STYLES: Record<BoxState, string> = {
  AVAILABLE: 'border-success/50 bg-success-subtle',
  TAKEN: 'border-border bg-surface-2',
  BLOCKED: 'border-dashed border-text-muted/50 bg-surface-2',
  MINE: 'border-primary bg-primary-subtle',
};

const STATE_LABELS: Record<BoxState, string> = {
  AVAILABLE: 'Available',
  TAKEN: 'Booked',
  BLOCKED: 'Blocked',
  MINE: 'Your booking',
};

export function SlotGrid({ boxes, phase, size = 'md', className }: SlotGridProps) {
  if (boxes.length === 0) {
    return <p className="text-sm text-text-muted">No slots are allotted to your company for this date.</p>;
  }

  return (
    <ul
      // A list with an accessible name, so a screen reader announces "12 slots" rather than a wall of divs.
      aria-label={`${boxes.length} parking slots`}
      className={cn('flex flex-wrap gap-1.5', className)}
    >
      {boxes.map((box) => {
        // Real slot number once decided; the 1-based grid position everywhere else (including OPEN,
        // where no box is ever MINE/TAKEN so a slot number would not exist yet).
        const showSlotNumber = phase === 'DECIDED' && (box.state === 'MINE' || box.state === 'TAKEN') && box.slotNumber != null;
        const shownAs = showSlotNumber ? box.slotNumber : box.index;
        return (
          <li
            key={box.index}
            title={`Slot ${shownAs} — ${STATE_LABELS[box.state]}`}
            className={cn(
              'flex items-center justify-center rounded-control border font-heading font-semibold tabular-nums',
              // A real slot number ("B-014") needs more room than a 1-2 digit index.
              size === 'sm' ? 'h-5 min-w-5 px-0.5 text-[10px]' : 'h-9 min-w-9 px-1 text-sm',
              STATE_STYLES[box.state],
              box.state === 'MINE' ? 'text-primary' : box.state === 'AVAILABLE' ? 'text-success' : 'text-text-muted',
            )}
          >
            <span className="sr-only">{`Slot ${shownAs}: ${STATE_LABELS[box.state]}`}</span>
            <span aria-hidden="true">{shownAs}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Key for the grid — spelled out once so each box does not need visible text. While `phase = OPEN`,
 * only Available + Blocked are shown: a legend entry for "Booked" pre-run would teach the user that
 * requests take a box, which is exactly the land-grab this phase removes (D22).
 */
export function SlotGridLegend({ phase, className }: { phase: DayAvailabilityPhase; className?: string }) {
  const items: BoxState[] = phase === 'OPEN' ? ['AVAILABLE', 'BLOCKED'] : ['AVAILABLE', 'TAKEN', 'BLOCKED', 'MINE'];
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-text-muted', className)}>
      {items.map((state) => (
        <li key={state} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cn('h-3 w-3 border', STATE_STYLES[state])} />
          {STATE_LABELS[state]}
        </li>
      ))}
    </ul>
  );
}
