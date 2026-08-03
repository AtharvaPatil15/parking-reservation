import type { BookingStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ValidationError } from '../../lib/errors';
import { isValidCalendarDate, parseCalendarDate } from './bookings.time';
import { addDays, checkRequestable, toIsoDate, type WindowConfig } from './bookings.window';

/**
 * Per-date slot availability for a company — the grid the user sees before submitting (Phase 7 §4).
 *
 * The point of this module is D12 (reserve on request): a *live request* occupies a box the moment it
 * is submitted, not when allocation runs. That is what makes "no rejections" true rather than
 * aspirational — demand can never exceed supply, so the weekly run has nobody to turn away.
 */

/** Statuses that hold a slot. RELEASED/EXPIRED/CANCELLED/REJECTED have given theirs back. */
export const LIVE_BOOKING_STATUSES: BookingStatus[] = ['DRAFT', 'SUBMITTED', 'WAITLISTED', 'ALLOCATED'];

export type BoxState = 'AVAILABLE' | 'TAKEN' | 'BLOCKED' | 'MINE';

/** Why a date cannot be requested. `null` when it can. */
export type UnavailableReason =
  | 'INVALID_DATE'
  | 'NOT_WEEKDAY'
  | 'TOO_SOON'
  | 'BEYOND_WINDOW'
  | 'NO_QUOTA'
  | 'FULL'
  | 'ALREADY_BOOKED';

export interface SlotBox {
  index: number;
  state: BoxState;
}

export interface DayAvailability {
  date: string;
  /** The company's effective quota for this date — this is the number of boxes (D14). */
  quota: number;
  blocked: number;
  taken: number;
  available: number;
  /** True when the caller already holds a live request for this date. */
  mine: boolean;
  requestable: boolean;
  reason: UnavailableReason | null;
  message: string | null;
  boxes: SlotBox[];
}

const MS_DAY = 24 * 60 * 60 * 1000;

/** Human text for the non-window reasons; window reasons carry their own message. */
const REASON_MESSAGE: Record<'NO_QUOTA' | 'FULL' | 'ALREADY_BOOKED', string> = {
  NO_QUOTA: 'Your company has no parking quota configured for this date.',
  FULL: 'All slots for this date are taken — pick another date.',
  ALREADY_BOOKED: 'You already have a request for this date.',
};

/**
 * Build the grid for every date in `[from, to]` for one company, from the caller's point of view.
 *
 * Reads quota rows and blocks once for the whole range and resolves them per date in memory, so the
 * query count is constant (4) no matter how wide the window is.
 */
export async function getAvailability(
  companyId: string,
  userId: string,
  from: string,
  to: string,
  cfg: WindowConfig,
  now: Date = new Date(),
): Promise<DayAvailability[]> {
  if (!isValidCalendarDate(from) || !isValidCalendarDate(to)) {
    throw new ValidationError('Request validation failed', [
      { field: !isValidCalendarDate(from) ? 'from' : 'to', message: 'Not a valid calendar date' },
    ]);
  }
  const fromDate = parseCalendarDate(from);
  const toDate = parseCalendarDate(to);
  if (toDate.getTime() < fromDate.getTime()) {
    throw new ValidationError('Request validation failed', [{ field: 'to', message: '`to` must not precede `from`' }]);
  }
  // Bound the span so a hostile `to` cannot ask the server to materialise years of days.
  const spanDays = Math.floor((toDate.getTime() - fromDate.getTime()) / MS_DAY) + 1;
  if (spanDays > 120) {
    throw new ValidationError('Request validation failed', [
      { field: 'to', message: 'Range must not exceed 120 days' },
    ]);
  }

  const [quotaRows, blocks, liveRequests, completedRuns] = await Promise.all([
    // Effective-dated quota: any row that can still be in force at some point in the range.
    prisma.companySlotAllocation.findMany({
      where: { companyId, effectiveFrom: { lte: toDate } },
      orderBy: { effectiveFrom: 'desc' },
      select: { slotCount: true, effectiveFrom: true, effectiveTo: true },
    }),
    prisma.slotBlock.findMany({
      where: { companyId, startDate: { lte: toDate }, endDate: { gte: fromDate } },
      select: { blockedCount: true, startDate: true, endDate: true },
    }),
    // Only PRIMARY draws on the company's own quota; a COMMON_POOL request is served from another
    // company's unused slots, so counting it here would double-book this company's grid.
    prisma.bookingRequest.findMany({
      where: {
        companyId,
        bookingType: 'PRIMARY',
        bookingDate: { gte: fromDate, lte: toDate },
        status: { in: LIVE_BOOKING_STATUSES },
      },
      select: { userId: true, bookingDate: true },
    }),
    // A date whose run already COMPLETED is closed regardless of what the window arithmetic says.
    prisma.allocationRun.findMany({
      where: {
        runType: 'PRIMARY',
        status: 'COMPLETED',
        bookingDate: { gte: fromDate, lte: toDate },
      },
      select: { bookingDate: true },
    }),
  ]);

  const takenByDate = new Map<string, number>();
  const mineByDate = new Set<string>();
  for (const r of liveRequests) {
    const iso = toIsoDate(r.bookingDate);
    takenByDate.set(iso, (takenByDate.get(iso) ?? 0) + 1);
    if (r.userId === userId) mineByDate.add(iso);
  }
  const decidedDates = new Set(completedRuns.map((r) => toIsoDate(r.bookingDate)));

  const quotaFor = (day: Date): number => {
    // Rows are newest-effectiveFrom first, so the first match is the one in force.
    const row = quotaRows.find(
      (q) =>
        q.effectiveFrom.getTime() <= day.getTime() &&
        (q.effectiveTo === null || q.effectiveTo.getTime() >= day.getTime()),
    );
    return row?.slotCount ?? 0;
  };
  const blockedFor = (day: Date): number =>
    blocks.reduce(
      (sum, b) =>
        b.startDate.getTime() <= day.getTime() && b.endDate.getTime() >= day.getTime()
          ? sum + b.blockedCount
          : sum,
      0,
    );

  const out: DayAvailability[] = [];
  for (let day = fromDate; day.getTime() <= toDate.getTime(); day = addDays(day, 1)) {
    const date = toIsoDate(day);
    const quota = quotaFor(day);
    const blocked = Math.min(quota, blockedFor(day));
    const taken = takenByDate.get(date) ?? 0;
    const mine = mineByDate.has(date);
    const available = Math.max(0, quota - blocked - taken);

    const windowCheck = checkRequestable(date, now, cfg);
    let reason: UnavailableReason | null = null;
    let message: string | null = null;
    if (!windowCheck.ok) {
      reason = windowCheck.code;
      message = windowCheck.message;
    } else if (decidedDates.has(date)) {
      reason = 'TOO_SOON';
      message = `${date} has already been allocated.`;
    } else if (quota === 0) {
      reason = 'NO_QUOTA';
      message = REASON_MESSAGE.NO_QUOTA;
    } else if (mine) {
      reason = 'ALREADY_BOOKED';
      message = REASON_MESSAGE.ALREADY_BOOKED;
    } else if (available === 0) {
      reason = 'FULL';
      message = REASON_MESSAGE.FULL;
    }

    out.push({
      date,
      quota,
      blocked,
      taken,
      available,
      mine,
      requestable: reason === null,
      reason,
      message,
      boxes: buildBoxes({ quota, blocked, taken, mine }),
    });
  }
  return out;
}

/**
 * Lay the grid out left-to-right as "filling up": the caller's own reservation first (so it survives
 * the clamp below and they can spot themselves), then other people's, then blocked, then free.
 *
 * The grid is `quota` boxes wide (D14). If quota was lowered *after* requests were taken, taken +
 * blocked can exceed it; the extra boxes are dropped rather than growing the grid past the real
 * capacity — every remaining box is grey in that case anyway, so nothing meaningful is hidden.
 */
export function buildBoxes(input: { quota: number; blocked: number; taken: number; mine: boolean }): SlotBox[] {
  const states: BoxState[] = [];
  if (input.mine) states.push('MINE');
  for (let i = 0; i < input.taken - (input.mine ? 1 : 0); i++) states.push('TAKEN');
  for (let i = 0; i < input.blocked; i++) states.push('BLOCKED');
  while (states.length < input.quota) states.push('AVAILABLE');
  return states.slice(0, input.quota).map((state, i) => ({ index: i + 1, state }));
}
