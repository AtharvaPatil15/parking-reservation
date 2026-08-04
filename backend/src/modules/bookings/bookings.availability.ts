import type { BookingStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ValidationError } from '../../lib/errors';
import { isValidCalendarDate, parseCalendarDate } from './bookings.time';
import { addDays, checkRequestable, toIsoDate, type WindowConfig } from './bookings.window';

/**
 * Per-date slot availability for a company — the grid the user sees (Phase 8 §5, D22).
 *
 * The grid has **two phases**, and the whole point of this module is that they say different things:
 *
 *  - `OPEN` — the date has not been decided yet. Boxes show *capacity only*: green for a free slot,
 *    grey-dashed for a blocked one. A queued request occupies **nothing**. Demand is reported as
 *    `requestCount` — a number, not a box.
 *  - `DECIDED` — the weekly run has completed for this date. Boxes now show *outcomes*, derived from
 *    `ParkingAllocation`: the viewer's own slot, other people's slots, blocked, and anything still
 *    unclaimed.
 *
 * This replaces Phase 7's reserve-on-request grid (D12), where a live request turned a box grey the
 * moment it was submitted. That made the box a thing to race for, and made the scored run decorative.
 * A request is a queue entry now (D18); scarcity is resolved once, by score, at run time.
 */

/** Statuses that still hold or contest a slot. RELEASED/EXPIRED/CANCELLED/REJECTED are out of play. */
export const LIVE_BOOKING_STATUSES: BookingStatus[] = ['DRAFT', 'SUBMITTED', 'WAITLISTED', 'ALLOCATED'];

/** Whether a date's allocation has been decided yet. Drives what the boxes mean. */
export type GridPhase = 'OPEN' | 'DECIDED';

export type BoxState = 'AVAILABLE' | 'TAKEN' | 'BLOCKED' | 'MINE';

/**
 * Why a date cannot be requested. `null` when it can.
 *
 * `FULL` was removed in Phase 8: a date can never be full for the purposes of *requesting*, however
 * many people are queued for it. If it ever comes back, the queue has become a reservation again.
 */
export type UnavailableReason =
  | 'INVALID_DATE'
  | 'NOT_WEEKDAY'
  | 'TOO_SOON'
  | 'BEYOND_WINDOW'
  | 'NO_QUOTA'
  | 'ALREADY_BOOKED';

export interface SlotBox {
  /** 1-based position in the grid. Stable, and unrelated to the physical slot. */
  index: number;
  state: BoxState;
  /**
   * The real `ParkingSlot.slotNumber`, once one is assigned. Always null while `phase` is `OPEN`.
   * A string, not a number — slot numbers are free-form labels (`A-01`), not an ordinal.
   */
  slotNumber: string | null;
}

export interface DayAvailability {
  date: string;
  phase: GridPhase;
  /** The company's effective quota for this date — this is the number of boxes (D14). */
  quota: number;
  blocked: number;
  /** How many people are queued for this date. Informational: it consumes no capacity (D18). */
  requestCount: number;
  /** Slots actually assigned out of this company's quota. Zero until the date is decided. */
  allocatedCount: number;
  available: number;
  /** True when the caller already holds a live request for this date. */
  mine: boolean;
  /** The caller's own outcome for this date, once they have asked. */
  myStatus: BookingStatus | null;
  /** The caller's assigned slot number, once they have one. */
  mySlotNumber: string | null;
  requestable: boolean;
  reason: UnavailableReason | null;
  message: string | null;
  boxes: SlotBox[];
}

const MS_DAY = 24 * 60 * 60 * 1000;

/** Human text for the non-window reasons; window reasons carry their own message. */
const REASON_MESSAGE: Record<'NO_QUOTA' | 'ALREADY_BOOKED', string> = {
  NO_QUOTA: 'Your company has no parking quota configured for this date.',
  ALREADY_BOOKED: 'You already have a request for this date.',
};

/** Best-first preference when a user holds more than one request for a date (PRIMARY + COMMON_POOL). */
const MY_STATUS_PRIORITY: Record<string, number> = {
  ALLOCATED: 0,
  WAITLISTED: 1,
  SUBMITTED: 2,
  DRAFT: 3,
  RELEASED: 4,
  EXPIRED: 5,
  CANCELLED: 6,
  REJECTED: 7,
};

/**
 * Build the grid for every date in `[from, to]` for one company, from the caller's point of view.
 *
 * Reads quota rows, blocks, requests, runs and allocations once for the whole range and resolves them
 * per date in memory, so the query count is constant (6) no matter how wide the window is.
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

  const [quotaRows, blocks, liveRequests, completedRuns, allocations, myRequests] = await Promise.all([
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
    // Demand, for `requestCount`. Only PRIMARY: a COMMON_POOL request is served from another company's
    // unused slots, so counting it as demand on this company's grid would double-count the user.
    prisma.bookingRequest.findMany({
      where: {
        companyId,
        bookingType: 'PRIMARY',
        bookingDate: { gte: fromDate, lte: toDate },
        status: { in: LIVE_BOOKING_STATUSES },
      },
      select: { bookingDate: true },
    }),
    // A date whose run has COMPLETED is decided — that, and only that, flips the phase.
    prisma.allocationRun.findMany({
      where: {
        runType: 'PRIMARY',
        status: 'COMPLETED',
        bookingDate: { gte: fromDate, lte: toDate },
      },
      select: { bookingDate: true },
    }),
    // Outcomes, for the DECIDED boxes. PRIMARY only: these are the slots that came out of *this*
    // company's quota, which is exactly what this quota-sized grid represents. A COMMON_POOL
    // allocation held by one of these users came from a different company's leftovers and is surfaced
    // through `myStatus`/`mySlotNumber` instead of as a box (Phase 8 §5.3).
    prisma.parkingAllocation.findMany({
      where: { companyId, allocationType: 'PRIMARY', bookingDate: { gte: fromDate, lte: toDate } },
      select: {
        bookingDate: true,
        slot: { select: { slotNumber: true } },
        bookingRequest: { select: { userId: true } },
      },
      orderBy: { slot: { slotNumber: 'asc' } },
    }),
    // The caller's own requests — any type, any status — so their own outcome is always reportable.
    prisma.bookingRequest.findMany({
      where: { userId, bookingDate: { gte: fromDate, lte: toDate } },
      select: {
        bookingDate: true,
        status: true,
        allocation: { select: { slot: { select: { slotNumber: true } } } },
      },
    }),
  ]);

  const requestCountByDate = new Map<string, number>();
  for (const r of liveRequests) {
    const iso = toIsoDate(r.bookingDate);
    requestCountByDate.set(iso, (requestCountByDate.get(iso) ?? 0) + 1);
  }

  const allocationsByDate = new Map<string, { slotNumber: string; userId: string }[]>();
  for (const a of allocations) {
    const iso = toIsoDate(a.bookingDate);
    const list = allocationsByDate.get(iso) ?? [];
    list.push({ slotNumber: a.slot.slotNumber, userId: a.bookingRequest.userId });
    allocationsByDate.set(iso, list);
  }

  // Best status per date: a user can hold a PRIMARY and a COMMON_POOL row for one day (the common-pool
  // run enrolls the waitlist), and "you got a slot" is the answer that matters.
  const mineByDate = new Map<string, { status: BookingStatus; slotNumber: string | null }>();
  for (const r of myRequests) {
    const iso = toIsoDate(r.bookingDate);
    const next = { status: r.status, slotNumber: r.allocation?.slot?.slotNumber ?? null };
    const current = mineByDate.get(iso);
    const better =
      !current ||
      (MY_STATUS_PRIORITY[next.status] ?? 99) < (MY_STATUS_PRIORITY[current.status] ?? 99);
    if (better) mineByDate.set(iso, next);
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
    const phase: GridPhase = decidedDates.has(date) ? 'DECIDED' : 'OPEN';
    const quota = quotaFor(day);
    const blocked = Math.min(quota, blockedFor(day));
    const requestCount = requestCountByDate.get(date) ?? 0;
    const dayAllocations = allocationsByDate.get(date) ?? [];
    const allocatedCount = dayAllocations.length;
    const own = mineByDate.get(date) ?? null;
    const mine = own !== null && LIVE_BOOKING_STATUSES.includes(own.status);
    // Queued requests never subtract from availability (D18) — only real assignments and blocks do.
    const available = Math.max(0, quota - blocked - allocatedCount);

    const windowCheck = checkRequestable(date, now, cfg);
    let reason: UnavailableReason | null = null;
    let message: string | null = null;
    if (!windowCheck.ok) {
      reason = windowCheck.code;
      message = windowCheck.message;
    } else if (phase === 'DECIDED') {
      reason = 'TOO_SOON';
      message = `${date} has already been allocated.`;
    } else if (quota === 0) {
      reason = 'NO_QUOTA';
      message = REASON_MESSAGE.NO_QUOTA;
    } else if (mine) {
      reason = 'ALREADY_BOOKED';
      message = REASON_MESSAGE.ALREADY_BOOKED;
    }

    out.push({
      date,
      phase,
      quota,
      blocked,
      requestCount,
      allocatedCount,
      available,
      mine,
      myStatus: own?.status ?? null,
      mySlotNumber: own?.slotNumber ?? null,
      requestable: reason === null,
      reason,
      message,
      boxes:
        phase === 'OPEN'
          ? buildOpenBoxes({ quota, blocked })
          : buildDecidedBoxes({ quota, blocked, allocations: dayAllocations, viewerId: userId }),
    });
  }
  return out;
}

const numbered = (states: Array<{ state: BoxState; slotNumber: string | null }>, quota: number): SlotBox[] =>
  states.slice(0, quota).map((s, i) => ({ index: i + 1, state: s.state, slotNumber: s.slotNumber }));

/**
 * Boxes for a date that has **not** been decided: pure capacity. Blocked slots first (they are the
 * part of the quota that is genuinely gone), then every remaining box green.
 *
 * No `TAKEN`, no `MINE` — deliberately. Under Phase 8 nobody holds anything until the run decides, so
 * a grey box here would be a lie, and a race to avoid.
 */
export function buildOpenBoxes(input: { quota: number; blocked: number }): SlotBox[] {
  const blocked = Math.min(input.blocked, input.quota);
  const states: Array<{ state: BoxState; slotNumber: string | null }> = [];
  for (let i = 0; i < blocked; i++) states.push({ state: 'BLOCKED', slotNumber: null });
  while (states.length < input.quota) states.push({ state: 'AVAILABLE', slotNumber: null });
  return numbered(states, input.quota);
}

/**
 * Boxes for a decided date: outcomes, from the allocation rows.
 *
 * Ordered caller-first — their own slot, then other people's, then blocked, then anything unclaimed —
 * so that if quota was lowered *after* allocation the clamp below drops other people's boxes before
 * the viewer's own. Being unable to find yourself in your own grid is the worst thing this can do.
 *
 * The grid stays exactly `quota` boxes wide (D14).
 */
export function buildDecidedBoxes(input: {
  quota: number;
  blocked: number;
  allocations: { slotNumber: string; userId: string }[];
  viewerId: string;
}): SlotBox[] {
  const states: Array<{ state: BoxState; slotNumber: string | null }> = [];
  const own = input.allocations.filter((a) => a.userId === input.viewerId);
  const others = input.allocations.filter((a) => a.userId !== input.viewerId);

  for (const a of own) states.push({ state: 'MINE', slotNumber: a.slotNumber });
  for (const a of others) states.push({ state: 'TAKEN', slotNumber: a.slotNumber });
  for (let i = 0; i < Math.min(input.blocked, input.quota); i++) states.push({ state: 'BLOCKED', slotNumber: null });
  while (states.length < input.quota) states.push({ state: 'AVAILABLE', slotNumber: null });

  return numbered(states, input.quota);
}
