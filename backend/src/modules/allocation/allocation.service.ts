import { Prisma, type AllocationRunStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { getNumber } from '../../config/systemConfig';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { isValidCalendarDate, parseCalendarDate } from '../bookings/bookings.time';
import {
  allocationBand,
  bookingWindowSummary,
  commonPoolRunAtFor,
  previousAllocationRunAt,
  upcomingAllocationBand,
  type AllocationBand,
} from '../bookings/bookings.window';
import { loadScoringConfig, loadWindowConfig } from '../bookings/bookings.windowConfig';
import { score, rankCandidates, type RankCandidate } from './score';
import type { PageArgs } from '../../lib/pagination';
import type { Role } from '../../lib/roles';

/**
 * Primary allocation service (P4-13) — the transactional run from spec §4.5.
 * Consumes the pure scoring/ranking engine (P4-11) and the booking data (P4-12).
 *
 * The run is idempotent per (runType=PRIMARY, bookingDate): a COMPLETED run short-circuits and
 * returns the cached result. Assignment happens inside a SERIALIZABLE transaction; the unique
 * (slotId, bookingDate) constraint on ParkingAllocation is the hard backstop against double-
 * assignment (AC). A FAILED run rolls back cleanly (statuses/allocations/breakdowns all revert),
 * so a re-run starts fresh.
 */

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

const DEFAULTS = { distanceWeight: 0.6, carpoolWeight: 0.4, maxDistanceKm: 40, maxPeople: 4 };

// A scored booking carried through ranking (RankCandidate + a ref back to the source row).
interface ScoredCandidate extends RankCandidate {
  bookingId: string;
  userId: string;
  companyId: string;
  breakdown: ReturnType<typeof score>;
}

/**
 * Quota still assignable to a company for a date: effective quota − blocks − PRIMARY slots it
 * **already holds** (P8-05a).
 *
 * Phase 7 could get away with `quota − blocked` because submit-time capping guaranteed the company
 * never held anything the run had not just decided. Under Phase 8 that is no longer true — a release
 * cascade hands a slot straight to a waitlisted colleague, and a forced re-run then sees candidates it
 * has not placed *and* allocations it did not make. Without subtracting them the same company could be
 * pushed past its own quota.
 *
 * Deliberately counts only `PRIMARY` allocations: a `COMMON_POOL` slot held by one of this company's
 * users came out of a *different* company's unused quota, so it must not consume this one's.
 */
async function remainingPrimaryQuotaTx(
  tx: Prisma.TransactionClient,
  companyId: string,
  date: Date,
): Promise<number> {
  const [effective, alreadyHeld] = await Promise.all([
    availableQuotaTx(tx, companyId, date),
    tx.parkingAllocation.count({
      where: { companyId, bookingDate: date, allocationType: 'PRIMARY' },
    }),
  ]);
  return Math.max(0, effective - alreadyHeld);
}

/** Effective quota − overlapping blocks, read on the transaction connection (mirrors slots.getAvailableQuota). */
async function availableQuotaTx(tx: Prisma.TransactionClient, companyId: string, date: Date): Promise<number> {
  const [quotaRow, blockedAgg] = await Promise.all([
    tx.companySlotAllocation.findFirst({
      where: {
        companyId,
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    }),
    tx.slotBlock.aggregate({
      _sum: { blockedCount: true },
      where: { companyId, startDate: { lte: date }, endDate: { gte: date } },
    }),
  ]);
  return Math.max(0, (quotaRow?.slotCount ?? 0) - (blockedAgg._sum.blockedCount ?? 0));
}

/**
 * Run (or idempotently re-run) primary allocation for a booking date. Returns the AllocationRun id.
 *
 * Score decides, and nothing caps it: a user who ranks first on all five weekdays wins all five.
 * That is deliberate (Prithviraj, 2026-08-05) — a per-user weekly cap was built and then removed,
 * because the score already encodes need (distance + carpool), and overriding it to spread slots
 * around would be a second, competing fairness rule that also left slots empty when everybody had
 * hit their limit. Fairness lives in the score and in tie-breaker 4 (fewer allocations in the prior
 * 30 days), not in a quota on winning.
 */
export async function runPrimaryAllocation(bookingDateStr: string, triggeredById?: string): Promise<string> {
  if (!isValidCalendarDate(bookingDateStr)) {
    throw new ValidationError('Request validation failed', [
      { field: 'bookingDate', message: 'Not a valid calendar date' },
    ]);
  }
  const bookingDate = parseCalendarDate(bookingDateStr);

  // Step 1 — idempotency guard. One run row per (runType, bookingDate).
  const existing = await prisma.allocationRun.upsert({
    where: { runType_bookingDate: { runType: 'PRIMARY', bookingDate } },
    update: {},
    create: {
      runType: 'PRIMARY',
      bookingDate,
      idempotencyKey: `PRIMARY:${bookingDateStr}`,
      status: 'PENDING',
    },
  });
  if (existing.status === 'COMPLETED') return existing.id; // cached — do not re-run

  const run = await prisma.allocationRun.update({
    where: { id: existing.id },
    data: {
      status: 'RUNNING',
      attemptCount: { increment: 1 },
      startedAt: new Date(),
      error: null,
      triggeredById: triggeredById ?? existing.triggeredById,
    },
  });

  try {
    // Steps 2–9 — one SERIALIZABLE transaction; unique (slotId,bookingDate) backstops double-assign.
    const [dw, cw, maxD, maxP] = await Promise.all([
      getNumber('allocation.distanceWeight'),
      getNumber('allocation.carpoolWeight'),
      getNumber('allocation.maxDistanceKm'),
      getNumber('carpool.maxPeople'),
    ]);
    const weights = { distanceWeight: dw ?? DEFAULTS.distanceWeight, carpoolWeight: cw ?? DEFAULTS.carpoolWeight };
    const caps = { maxDistanceKm: maxD ?? DEFAULTS.maxDistanceKm, maxPeople: maxP ?? DEFAULTS.maxPeople };

    await prisma.$transaction(
      async (tx) => {
        // Step 3 — load SUBMITTED PRIMARY bookings; score each (people = 1 + scored members, F4).
        const bookings = await tx.bookingRequest.findMany({
          where: { bookingDate, bookingType: 'PRIMARY', status: 'SUBMITTED' },
          include: { carpoolMembers: { where: { isScored: true }, select: { id: true } } },
        });

        // Prior-30d allocations per user (tie-breaker 4, fairness D4).
        const d30 = new Date(bookingDate);
        d30.setUTCDate(d30.getUTCDate() - 30);
        const prev30 = new Map<string, number>();
        for (const userId of new Set(bookings.map((b) => b.userId))) {
          prev30.set(
            userId,
            await tx.parkingAllocation.count({
              where: { bookingDate: { gte: d30, lt: bookingDate }, bookingRequest: { userId } },
            }),
          );
        }

        const scored: ScoredCandidate[] = bookings.map((b) => {
          const people = 1 + b.carpoolMembers.length;
          const distanceKm = b.travelDistanceKm != null ? Number(b.travelDistanceKm) : 0;
          const breakdown = score({ distanceKm, people }, weights, caps);
          return {
            bookingId: b.id,
            userId: b.userId,
            companyId: b.companyId,
            breakdown,
            finalScore: breakdown.finalScore,
            people,
            distanceKm,
            submittedAt: b.submittedAt ?? b.createdAt,
            allocationsPrev30d: prev30.get(b.userId) ?? 0,
          };
        });

        // Step 6 (prep) — shared assignable slot pool: usable slots not already taken for the date.
        const taken = await tx.parkingAllocation.findMany({ where: { bookingDate }, select: { slotId: true } });
        const takenIds = taken.map((t) => t.slotId);
        const pool = await tx.parkingSlot.findMany({
          where: {
            deletedAt: null,
            status: 'AVAILABLE',
            ...(takenIds.length ? { id: { notIn: takenIds } } : {}),
          },
          orderBy: { slotNumber: 'asc' },
        });

        // Step 4/5 — group by company, rank within company, assign up to available quota.
        const byCompany = new Map<string, ScoredCandidate[]>();
        for (const s of scored) {
          const list = byCompany.get(s.companyId) ?? [];
          list.push(s);
          byCompany.set(s.companyId, list);
        }

        // Resolve every company's headroom up front, so the shortfall check below can see the whole
        // picture before a single slot is handed out.
        const companyIds = [...byCompany.keys()].sort();
        const remainingByCompany = new Map<string, number>();
        for (const companyId of companyIds) {
          remainingByCompany.set(companyId, await remainingPrimaryQuotaTx(tx, companyId, bookingDate));
        }

        // P8-05b — refuse to run rather than starve a tenant.
        //
        // Companies are walked in a fixed order sharing one cursor over the physical slot pool, so if
        // the building is under-provisioned the *last* company in that order silently receives nothing
        // — an outcome decided by UUID ordering, which is indefensible and nearly invisible. Phase 7
        // hid this: submit-time capping meant demand could never reach the pool's limit. Under Phase 8
        // over-subscription is the normal case, so fail loudly and name the shortfall; the Super Admin
        // can then fix quotas or add slots. (Degrading proportionally would be kinder, and is a
        // deliberate non-goal here — an arbitrary winner is worse than an explicit error.)
        const demanded = companyIds.reduce(
          (sum, id) => sum + Math.min(remainingByCompany.get(id) ?? 0, byCompany.get(id)!.length),
          0,
        );
        if (demanded > pool.length) {
          throw new Error(
            `Not enough usable parking slots for ${bookingDateStr}: ${pool.length} assignable, but ` +
              `${demanded} needed across ${companyIds.length} company/companies within quota. ` +
              `Add slots or reduce company quotas before running allocation.`,
          );
        }

        let poolIdx = 0;
        const allocated: { cand: ScoredCandidate; slotId: string; rank: number; randomDraw: number }[] = [];
        const waitlisted: { cand: ScoredCandidate; rank: number; randomDraw: number }[] = [];

        for (const companyId of companyIds) {
          const group = byCompany.get(companyId)!;
          const available = remainingByCompany.get(companyId) ?? 0;
          const ranked = rankCandidates(group);
          ranked.forEach((r, i) => {
            const withinQuota = i < available;
            const slot = withinQuota && poolIdx < pool.length ? pool[poolIdx] : null;
            if (slot) {
              poolIdx += 1;
              allocated.push({ cand: r.candidate, slotId: slot.id, rank: r.rank, randomDraw: r.randomDraw });
            } else {
              waitlisted.push({ cand: r.candidate, rank: r.rank, randomDraw: r.randomDraw });
            }
          });
        }

        // Step 6/7/8 — persist allocations, statuses, and a breakdown for EVERY considered booking.
        const now = new Date();
        for (const a of allocated) {
          await tx.parkingAllocation.create({
            data: {
              bookingRequestId: a.cand.bookingId,
              slotId: a.slotId,
              bookingDate,
              companyId: a.cand.companyId,
              allocationType: 'PRIMARY',
              allocationRunId: run.id,
            },
          });
          await tx.bookingRequest.update({
            where: { id: a.cand.bookingId },
            data: { status: 'ALLOCATED', allocationScore: a.cand.breakdown.finalScore, allocationTime: now },
          });
        }
        for (const w of waitlisted) {
          await tx.bookingRequest.update({
            where: { id: w.cand.bookingId },
            data: { status: 'WAITLISTED', allocationScore: w.cand.breakdown.finalScore },
          });
        }

        const rows = [
          ...allocated.map((a) => ({ ...a, outcome: 'ALLOCATED' as const })),
          ...waitlisted.map((w) => ({ ...w, outcome: 'WAITLISTED' as const, slotId: null })),
        ];
        for (const r of rows) {
          const b = r.cand;
          await tx.allocationScoreBreakdown.create({
            data: {
              bookingRequestId: b.bookingId,
              allocationRunId: run.id,
              distanceScore: b.breakdown.distanceScore,
              carpoolScore: b.breakdown.carpoolScore,
              distanceWeight: b.breakdown.distanceWeight,
              carpoolWeight: b.breakdown.carpoolWeight,
              finalScore: b.breakdown.finalScore,
              travellerCount: b.people,
              // Full tie-breaker provenance so any outcome is explainable + replayable (decisions §3).
              tieBreakerData: {
                withinCompanyRank: r.rank,
                people: b.people,
                distanceKm: b.distanceKm,
                submittedAt: (b.submittedAt instanceof Date ? b.submittedAt : new Date(b.submittedAt)).toISOString(),
                allocationsPrev30d: b.allocationsPrev30d,
                randomDraw: r.randomDraw,
                outcome: r.outcome,
              },
            },
          });
        }
      },
      { isolationLevel: 'Serializable', timeout: 30_000 },
    );

    // Step 9 — mark COMPLETED.
    await prisma.allocationRun.update({
      where: { id: run.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  } catch (err) {
    await prisma.allocationRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', error: (err instanceof Error ? err.message : String(err)).slice(0, 500) },
    });
    throw err;
  }

  // Step 10 (notifications) is P4-16 — hook lands there.
  return run.id;
}

/** Run status + summary counts (openapi AllocationRunSummary). 404 if the run is unknown. */
export async function getRunSummary(runId: string) {
  const run = await prisma.allocationRun.findUnique({ where: { id: runId } });
  if (!run) throw new NotFoundError('Allocation run not found');
  const [totalRequests, allocatedCount] = await Promise.all([
    prisma.allocationScoreBreakdown.count({ where: { allocationRunId: run.id } }),
    prisma.parkingAllocation.count({ where: { allocationRunId: run.id } }),
  ]);
  return { run, totalRequests, allocatedCount, waitlistedCount: totalRequests - allocatedCount };
}

/**
 * Look up the single run for (runType, bookingDate), or null when none has been triggered yet. Lets
 * the UI tell whether allocation has already been done for a date — and show its stored results —
 * without starting a run. Mirrors getRunSummary's shape so the same controller mapper applies.
 */
export async function getRunByDate(runType: 'PRIMARY' | 'COMMON_POOL', bookingDateStr: string) {
  if (!isValidCalendarDate(bookingDateStr)) {
    throw new ValidationError('Request validation failed', [
      { field: 'date', message: 'Not a valid calendar date' },
    ]);
  }
  const bookingDate = parseCalendarDate(bookingDateStr);
  const run = await prisma.allocationRun.findUnique({
    where: { runType_bookingDate: { runType, bookingDate } },
  });
  if (!run) return null;
  const [totalRequests, allocatedCount] = await Promise.all([
    prisma.allocationScoreBreakdown.count({ where: { allocationRunId: run.id } }),
    prisma.parkingAllocation.count({ where: { allocationRunId: run.id } }),
  ]);
  return { run, totalRequests, allocatedCount, waitlistedCount: totalRequests - allocatedCount };
}

/**
 * Run (or idempotently re-run) COMMON-POOL allocation for a booking date. Returns the run id.
 *
 * The common pool is the cross-company redistribution of *unused* capacity after primary. Because
 * the POC has no separate user opt-in flow yet, this run treats the users WAITLISTED by primary as
 * the common-pool population: it enrolls each as a SUBMITTED `COMMON_POOL` booking (snapshotting the
 * primary request), derives the pool inventory from every company's unused quota
 * (availableQuota − primaryAllocated) as `CommonPoolSlot` rows over the leftover physical slots, then
 * ranks the COMMON_POOL requests *across all companies* by FinalScore and assigns the pool, top-first.
 * Idempotent per (runType=COMMON_POOL, bookingDate); a COMPLETED run short-circuits.
 */
export async function runCommonPoolAllocation(bookingDateStr: string, triggeredById?: string): Promise<string> {
  if (!isValidCalendarDate(bookingDateStr)) {
    throw new ValidationError('Request validation failed', [
      { field: 'bookingDate', message: 'Not a valid calendar date' },
    ]);
  }
  const bookingDate = parseCalendarDate(bookingDateStr);

  const existing = await prisma.allocationRun.upsert({
    where: { runType_bookingDate: { runType: 'COMMON_POOL', bookingDate } },
    update: {},
    create: {
      runType: 'COMMON_POOL',
      bookingDate,
      idempotencyKey: `COMMON_POOL:${bookingDateStr}`,
      status: 'PENDING',
    },
  });
  if (existing.status === 'COMPLETED') return existing.id; // cached — do not re-run

  const run = await prisma.allocationRun.update({
    where: { id: existing.id },
    data: {
      status: 'RUNNING',
      attemptCount: { increment: 1 },
      startedAt: new Date(),
      error: null,
      triggeredById: triggeredById ?? existing.triggeredById,
    },
  });

  try {
    const [dw, cw, maxD, maxP] = await Promise.all([
      getNumber('allocation.distanceWeight'),
      getNumber('allocation.carpoolWeight'),
      getNumber('allocation.maxDistanceKm'),
      getNumber('carpool.maxPeople'),
    ]);
    const weights = { distanceWeight: dw ?? DEFAULTS.distanceWeight, carpoolWeight: cw ?? DEFAULTS.carpoolWeight };
    const caps = { maxDistanceKm: maxD ?? DEFAULTS.maxDistanceKm, maxPeople: maxP ?? DEFAULTS.maxPeople };

    await prisma.$transaction(
      async (tx) => {
        // Step A — enroll: WAITLISTED primary users become SUBMITTED COMMON_POOL requests (POC: no
        // separate opt-in). Scored carpool members drive the carpool sub-score, so carry that count.
        const waitlisted = await tx.bookingRequest.findMany({
          where: { bookingDate, bookingType: 'PRIMARY', status: 'WAITLISTED' },
          include: { carpoolMembers: { where: { isScored: true }, select: { id: true } } },
        });
        const existingCp = await tx.bookingRequest.findMany({
          where: { bookingDate, bookingType: 'COMMON_POOL' },
          select: { userId: true },
        });
        const enrolledUserIds = new Set(existingCp.map((b) => b.userId));
        for (const w of waitlisted) {
          if (enrolledUserIds.has(w.userId)) continue;
          await tx.bookingRequest.create({
            data: {
              bookingDate,
              userId: w.userId,
              companyId: w.companyId,
              bookingType: 'COMMON_POOL',
              status: 'SUBMITTED',
              userAddress: w.userAddress,
              pinCode: w.pinCode,
              travelDistanceKm: w.travelDistanceKm,
              vehicleType: w.vehicleType,
              vehicleNumber: w.vehicleNumber,
              carpoolMemberCount: w.carpoolMembers.length,
              specialRequirement: w.specialRequirement,
              submittedAt: new Date(),
            },
          });
          enrolledUserIds.add(w.userId);
        }

        // Step B — derive inventory. Leftover = usable slots not already allocated for the date;
        // cap = Σ per-company unused quota (availableQuota − primaryAllocated). Rebuilt each run.
        const taken = await tx.parkingAllocation.findMany({ where: { bookingDate }, select: { slotId: true } });
        const takenIds = taken.map((t) => t.slotId);
        const leftover = await tx.parkingSlot.findMany({
          where: {
            deletedAt: null,
            status: 'AVAILABLE',
            ...(takenIds.length ? { id: { notIn: takenIds } } : {}),
          },
          orderBy: { slotNumber: 'asc' },
        });

        const companies = await tx.company.findMany({
          where: { status: 'ACTIVE', deletedAt: null },
          select: { id: true },
        });
        const unusedByCompany: { companyId: string; unused: number }[] = [];
        for (const c of companies) {
          const [available, primaryAllocated] = await Promise.all([
            availableQuotaTx(tx, c.id, bookingDate),
            tx.parkingAllocation.count({ where: { companyId: c.id, bookingDate, allocationType: 'PRIMARY' } }),
          ]);
          const unused = Math.max(0, available - primaryAllocated);
          if (unused > 0) unusedByCompany.push({ companyId: c.id, unused });
        }
        const cap = unusedByCompany.reduce((s, u) => s + u.unused, 0);

        await tx.commonPoolSlot.deleteMany({ where: { bookingDate } });
        const poolSlotBySlotId = new Map<string, string>(); // physical slotId -> CommonPoolSlot id
        const poolSlotIds: string[] = []; // the assignable pool, in slot-number order
        let idx = 0;
        for (const u of unusedByCompany) {
          for (let k = 0; k < u.unused && idx < Math.min(cap, leftover.length); k++, idx++) {
            const slot = leftover[idx];
            const cp = await tx.commonPoolSlot.create({
              data: { bookingDate, slotId: slot.id, sourceCompanyId: u.companyId, status: 'AVAILABLE' },
            });
            poolSlotBySlotId.set(slot.id, cp.id);
            poolSlotIds.push(slot.id);
          }
        }

        // Step C — rank COMMON_POOL requests cross-company by FinalScore; assign the pool top-first.
        const cpBookings = await tx.bookingRequest.findMany({
          where: { bookingDate, bookingType: 'COMMON_POOL', status: 'SUBMITTED' },
        });

        const d30 = new Date(bookingDate);
        d30.setUTCDate(d30.getUTCDate() - 30);
        const prev30 = new Map<string, number>();
        for (const userId of new Set(cpBookings.map((b) => b.userId))) {
          prev30.set(
            userId,
            await tx.parkingAllocation.count({
              where: { bookingDate: { gte: d30, lt: bookingDate }, bookingRequest: { userId } },
            }),
          );
        }

        const scored: ScoredCandidate[] = cpBookings.map((b) => {
          const people = 1 + b.carpoolMemberCount;
          const distanceKm = b.travelDistanceKm != null ? Number(b.travelDistanceKm) : 0;
          const breakdown = score({ distanceKm, people }, weights, caps);
          return {
            bookingId: b.id,
            userId: b.userId,
            companyId: b.companyId,
            breakdown,
            finalScore: breakdown.finalScore,
            people,
            distanceKm,
            submittedAt: b.submittedAt ?? b.createdAt,
            allocationsPrev30d: prev30.get(b.userId) ?? 0,
          };
        });

        const ranked = rankCandidates(scored);
        const allocated: { cand: ScoredCandidate; slotId: string; rank: number; randomDraw: number }[] = [];
        const waitlist: { cand: ScoredCandidate; rank: number; randomDraw: number }[] = [];
        ranked.forEach((r, i) => {
          const slotId = i < poolSlotIds.length ? poolSlotIds[i] : null;
          if (slotId) allocated.push({ cand: r.candidate, slotId, rank: r.rank, randomDraw: r.randomDraw });
          else waitlist.push({ cand: r.candidate, rank: r.rank, randomDraw: r.randomDraw });
        });

        const now = new Date();
        for (const a of allocated) {
          await tx.parkingAllocation.create({
            data: {
              bookingRequestId: a.cand.bookingId,
              slotId: a.slotId,
              bookingDate,
              companyId: a.cand.companyId,
              allocationType: 'COMMON_POOL',
              allocationRunId: run.id,
            },
          });
          await tx.commonPoolSlot.update({
            where: { id: poolSlotBySlotId.get(a.slotId)! },
            data: { status: 'ALLOCATED' },
          });
          await tx.bookingRequest.update({
            where: { id: a.cand.bookingId },
            data: { status: 'ALLOCATED', allocationScore: a.cand.breakdown.finalScore, allocationTime: now },
          });
        }
        for (const w of waitlist) {
          await tx.bookingRequest.update({
            where: { id: w.cand.bookingId },
            data: { status: 'WAITLISTED', allocationScore: w.cand.breakdown.finalScore },
          });
        }

        // Breakdown per COMMON_POOL request (fresh ids — no clash with the primary run's rows).
        const rows = [
          ...allocated.map((a) => ({ ...a, outcome: 'ALLOCATED' as const })),
          ...waitlist.map((w) => ({ ...w, outcome: 'WAITLISTED' as const, slotId: null })),
        ];
        for (const r of rows) {
          const b = r.cand;
          await tx.allocationScoreBreakdown.create({
            data: {
              bookingRequestId: b.bookingId,
              allocationRunId: run.id,
              distanceScore: b.breakdown.distanceScore,
              carpoolScore: b.breakdown.carpoolScore,
              distanceWeight: b.breakdown.distanceWeight,
              carpoolWeight: b.breakdown.carpoolWeight,
              finalScore: b.breakdown.finalScore,
              travellerCount: b.people,
              tieBreakerData: {
                crossCompanyRank: r.rank,
                people: b.people,
                distanceKm: b.distanceKm,
                submittedAt: (b.submittedAt instanceof Date ? b.submittedAt : new Date(b.submittedAt)).toISOString(),
                allocationsPrev30d: b.allocationsPrev30d,
                randomDraw: r.randomDraw,
                outcome: r.outcome,
              },
            },
          });
        }
      },
      { isolationLevel: 'Serializable', timeout: 30_000 },
    );

    await prisma.allocationRun.update({
      where: { id: run.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  } catch (err) {
    await prisma.allocationRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', error: (err instanceof Error ? err.message : String(err)).slice(0, 500) },
    });
    throw err;
  }

  return run.id;
}

// ---------------------------------------------------------------------------
// Weekly batch run (Phase 7 D10)
// ---------------------------------------------------------------------------

export interface WeeklyRunDateResult {
  bookingDate: string;
  runId: string;
  status: AllocationRunStatus;
  /** True when this date had already been decided by an earlier run and was left untouched. */
  alreadyDecided: boolean;
  allocated: number;
  waitlisted: number;
  error: string | null;
}

export interface WeeklyRunResult {
  runAt: string;
  band: AllocationBand;
  dates: WeeklyRunDateResult[];
  totalAllocated: number;
  totalWaitlisted: number;
}

/**
 * Run the weekly weekend batch (Phase 7 D10/D11).
 *
 * This is a thin band-scoped loop over the existing per-date `runPrimaryAllocation`, deliberately:
 * that run is already idempotent per (PRIMARY, date), transactional, and score-explaining, so the
 * batch inherits all of it. What the batch adds is *which* dates a run owns — the half-open band
 * `[today + leadDays, nextRunDate + leadDays)` — which is what guarantees every date is decided
 * exactly once and always at least `approvalLeadDays` ahead of itself.
 *
 * Dates already COMPLETED by an earlier run short-circuit inside `runPrimaryAllocation` and are
 * reported as `alreadyDecided`, so re-invoking the batch is safe. One date failing does not abort the
 * rest — each date is independent, and its error is reported in that date's row.
 *
 * `runInstant` is the scheduled slot this invocation is fulfilling, and callers who *are* that slot must
 * pass it. Without it the band is anchored on `upcomingAllocationBand(now)` — the band of the next run
 * *after* `now` — which is right for a Super Admin clicking ahead of schedule but wrong for the
 * scheduler, which by definition fires at or after its slot: `nextAllocationRunAt` treats an instant
 * exactly at the run as already under way, so the anchor has rolled a week forward by then. The batch
 * would decide next week's dates and leave the requests whose window just closed permanently
 * undecided — closed to new requests (`earliestRequestableDate` moved past them too) and owned by no
 * future run.
 */
export async function runWeeklyAllocation(
  triggeredById?: string,
  now: Date = new Date(),
  runInstant?: Date,
): Promise<WeeklyRunResult> {
  const cfg = await loadWindowConfig();
  const band = runInstant ? allocationBand(runInstant, cfg) : upcomingAllocationBand(now, cfg);

  const dates: WeeklyRunDateResult[] = [];
  for (const bookingDate of band.dates) {
    const parsed = parseCalendarDate(bookingDate);
    const before = await prisma.allocationRun.findUnique({
      where: { runType_bookingDate: { runType: 'PRIMARY', bookingDate: parsed } },
      select: { status: true },
    });
    const alreadyDecided = before?.status === 'COMPLETED';

    let runId: string;
    try {
      runId = await runPrimaryAllocation(bookingDate, triggeredById);
    } catch (err) {
      dates.push({
        bookingDate,
        runId: '',
        status: 'FAILED',
        alreadyDecided,
        allocated: 0,
        waitlisted: 0,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const [run, allocated, waitlisted] = await Promise.all([
      prisma.allocationRun.findUnique({ where: { id: runId }, select: { status: true, error: true } }),
      prisma.parkingAllocation.count({ where: { allocationRunId: runId } }),
      prisma.bookingRequest.count({ where: { bookingDate: parsed, bookingType: 'PRIMARY', status: 'WAITLISTED' } }),
    ]);
    dates.push({
      bookingDate,
      runId,
      status: run?.status ?? 'FAILED',
      alreadyDecided,
      allocated,
      waitlisted,
      error: run?.error ?? null,
    });
  }

  return {
    runAt: now.toISOString(),
    band,
    dates,
    totalAllocated: dates.reduce((s, d) => s + d.allocated, 0),
    totalWaitlisted: dates.reduce((s, d) => s + d.waitlisted, 0),
  };
}

/**
 * Run the common pool across the whole band the weekly batch owns — the band-scoped sibling of
 * `runWeeklyAllocation`, and the second half of a weekly decision.
 *
 * Same shape and same reasoning as the primary batch: a thin loop over the already-idempotent,
 * already-transactional per-date `runCommonPoolAllocation`, adding only *which* dates are in scope.
 * One date failing is reported in that date's row and does not abort the rest.
 *
 * Counting note — the numbers here are NOT the primary run's. The common-pool run enrolls each
 * primary-waitlisted user as a *separate* `COMMON_POOL` booking and leaves the original `PRIMARY` row
 * `WAITLISTED` for good. So `allocated`/`waitlisted` must both be read off the COMMON_POOL rows;
 * counting PRIMARY waitlist here would report the pool as having achieved nothing.
 *
 * `runInstant` is the **primary** run's instant, not the pool's. The pool must land on the band primary
 * just decided, and the pool fires later on the same day — anchoring on its own instant would be
 * self-defeating once `commonPoolRunTime` pushes it past the point where `nextAllocationRunAt` has rolled
 * a week forward. See `runWeeklyAllocation` for why the un-anchored form is wrong for a scheduled call.
 */
export async function runWeeklyCommonPoolAllocation(
  triggeredById?: string,
  now: Date = new Date(),
  runInstant?: Date,
): Promise<WeeklyRunResult> {
  const cfg = await loadWindowConfig();
  const band = runInstant ? allocationBand(runInstant, cfg) : upcomingAllocationBand(now, cfg);

  const dates: WeeklyRunDateResult[] = [];
  for (const bookingDate of band.dates) {
    const parsed = parseCalendarDate(bookingDate);
    const before = await prisma.allocationRun.findUnique({
      where: { runType_bookingDate: { runType: 'COMMON_POOL', bookingDate: parsed } },
      select: { status: true },
    });
    const alreadyDecided = before?.status === 'COMPLETED';

    let runId: string;
    try {
      runId = await runCommonPoolAllocation(bookingDate, triggeredById);
    } catch (err) {
      dates.push({
        bookingDate,
        runId: '',
        status: 'FAILED',
        alreadyDecided,
        allocated: 0,
        waitlisted: 0,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const [run, allocated, waitlisted] = await Promise.all([
      prisma.allocationRun.findUnique({ where: { id: runId }, select: { status: true, error: true } }),
      prisma.parkingAllocation.count({ where: { allocationRunId: runId } }),
      prisma.bookingRequest.count({
        where: { bookingDate: parsed, bookingType: 'COMMON_POOL', status: 'WAITLISTED' },
      }),
    ]);
    dates.push({
      bookingDate,
      runId,
      status: run?.status ?? 'FAILED',
      alreadyDecided,
      allocated,
      waitlisted,
      error: run?.error ?? null,
    });
  }

  return {
    runAt: now.toISOString(),
    band,
    dates,
    totalAllocated: dates.reduce((s, d) => s + d.allocated, 0),
    totalWaitlisted: dates.reduce((s, d) => s + d.waitlisted, 0),
  };
}

/**
 * Per-date state of one band: what each run type did (or has yet to do) and the counts an operator needs
 * to judge whether running it would achieve anything.
 *
 * Extracted so the upcoming band and the already-decided band are described by the *same* query, and so
 * the two tables on the weekly screen cannot drift into meaning subtly different things.
 */
async function bandSnapshot(band: AllocationBand) {
  const inBand = { gte: parseCalendarDate(band.from), lt: parseCalendarDate(band.toExclusive) };
  const [runs, pending, waiting, allocated] = await Promise.all([
    prisma.allocationRun.findMany({
      where: { runType: { in: ['PRIMARY', 'COMMON_POOL'] }, bookingDate: inBand },
      select: { runType: true, bookingDate: true, status: true },
    }),
    prisma.bookingRequest.groupBy({
      by: ['bookingDate'],
      where: { bookingType: 'PRIMARY', status: 'SUBMITTED', bookingDate: inBand },
      _count: { _all: true },
    }),
    // The pool's population: users primary left WAITLISTED. This is what the common-pool run has to
    // work with, so it is the count that tells the operator whether running it would achieve anything.
    prisma.bookingRequest.groupBy({
      by: ['bookingDate'],
      where: { bookingType: 'PRIMARY', status: 'WAITLISTED', bookingDate: inBand },
      _count: { _all: true },
    }),
    // Split by type: "8 primary + 2 from the pool" is the outcome, and a single total would hide the
    // pool having done anything at all.
    prisma.parkingAllocation.groupBy({
      by: ['bookingDate', 'allocationType'],
      where: { bookingDate: inBand },
      _count: { _all: true },
    }),
  ]);

  const statusByDate = new Map(
    runs.filter((r) => r.runType === 'PRIMARY').map((r) => [isoDate(r.bookingDate), r.status]),
  );
  const cpStatusByDate = new Map(
    runs.filter((r) => r.runType === 'COMMON_POOL').map((r) => [isoDate(r.bookingDate), r.status]),
  );
  const pendingByDate = new Map(pending.map((p) => [isoDate(p.bookingDate), p._count._all]));
  const waitingByDate = new Map(waiting.map((w) => [isoDate(w.bookingDate), w._count._all]));
  const countFor = (type: 'PRIMARY' | 'COMMON_POOL') =>
    new Map(
      allocated.filter((a) => a.allocationType === type).map((a) => [isoDate(a.bookingDate), a._count._all]),
    );
  const primaryAllocByDate = countFor('PRIMARY');
  const poolAllocByDate = countFor('COMMON_POOL');

  return band.dates.map((d) => ({
    bookingDate: d,
    runStatus: statusByDate.get(d) ?? null,
    pendingRequests: pendingByDate.get(d) ?? 0,
    commonPoolStatus: cpStatusByDate.get(d) ?? null,
    waitlistedRequests: waitingByDate.get(d) ?? 0,
    allocated: primaryAllocByDate.get(d) ?? 0,
    poolAllocated: poolAllocByDate.get(d) ?? 0,
  }));
}

/**
 * Preview the band the next (or current) weekly batch owns — lets the SA see it before running — plus
 * `lastRun`, the band the most recent scheduled run already decided.
 *
 * `lastRun` exists because the upcoming band alone made the automatic run invisible: the moment the run
 * instant passes, `upcomingAllocationBand` rolls to the *following* week, so a Super Admin opening this
 * screen after a Sunday-night batch saw an empty next-week band and no trace of what had just been
 * decided — the results were only ever rendered from the button's own mutation response, i.e. only for
 * whoever clicked. Read from the database instead, so an automatic run shows up exactly like a manual one.
 *
 * The two bands are contiguous by construction (`lastRun.band.toExclusive === band.from`), so together
 * they account for every date currently in play without overlapping.
 */
export async function getWeeklyRunPreview(now: Date = new Date()) {
  const [cfg, scoring] = await Promise.all([loadWindowConfig(), loadScoringConfig()]);
  const band = upcomingAllocationBand(now, cfg);
  const lastRunAt = previousAllocationRunAt(now, cfg);
  const lastBand = allocationBand(lastRunAt, cfg);
  const [dates, lastDates] = await Promise.all([bandSnapshot(band), bandSnapshot(lastBand)]);

  return {
    window: bookingWindowSummary(now, cfg, scoring),
    band,
    dates,
    lastRun: {
      runAt: lastRunAt.toISOString(),
      commonPoolRunAt: commonPoolRunAtFor(lastRunAt, cfg).toISOString(),
      band: lastBand,
      dates: lastDates,
    },
  };
}

/**
 * Per-slot allocation roster (who holds which seat, for what date, primary vs common pool).
 * COMPANY_ADMIN is forced to their own company; SUPER_ADMIN sees all and may narrow with `companyId`.
 * Optional `date`/`type` filters. Newest date first.
 */
export async function listAllocations(
  principal: { role: Role; companyId: string },
  filter: { date?: string; companyId?: string; type?: 'PRIMARY' | 'COMMON_POOL' },
  page: PageArgs,
) {
  const where: Prisma.ParkingAllocationWhereInput = {};
  // Allow-listed tenant scoping: only SUPER_ADMIN gets the building-wide view. Any other non-CA role
  // (the route admits none today) must not fall through to "no filter" = every company.
  if (principal.role === 'SUPER_ADMIN') {
    if (filter.companyId) where.companyId = filter.companyId;
  } else {
    where.companyId = principal.companyId;
  }
  if (filter.date) where.bookingDate = parseCalendarDate(filter.date);
  if (filter.type) where.allocationType = filter.type;

  const [rows, total] = await Promise.all([
    prisma.parkingAllocation.findMany({
      where,
      include: {
        slot: { select: { slotNumber: true } },
        bookingRequest: {
          select: {
            allocationScore: true,
            user: { select: { fullName: true, email: true } },
            company: { select: { name: true } },
          },
        },
      },
      orderBy: [{ bookingDate: 'desc' }, { allocatedAt: 'asc' }],
      skip: page.skip,
      take: page.take,
    }),
    prisma.parkingAllocation.count({ where }),
  ]);
  return { rows, total };
}

/** Per-user ranked breakdown for a run (openapi AllocationBreakdown). 404 if the run is unknown. */
export async function getRunBreakdown(runId: string) {
  const run = await prisma.allocationRun.findUnique({ where: { id: runId } });
  if (!run) throw new NotFoundError('Allocation run not found');
  const rows = await prisma.allocationScoreBreakdown.findMany({
    where: { allocationRunId: run.id },
    orderBy: { finalScore: 'desc' },
    include: {
      bookingRequest: {
        select: {
          id: true,
          status: true,
          userId: true,
          travelDistanceKm: true,
          user: { select: { fullName: true } },
          company: { select: { name: true } },
          allocation: { select: { slot: { select: { slotNumber: true } } } },
        },
      },
    },
  });
  return { run, rows };
}
