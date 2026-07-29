import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { getNumber } from '../../config/systemConfig';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { isValidCalendarDate, parseCalendarDate } from '../bookings/bookings.time';
import { score, rankCandidates, type RankCandidate } from './score';

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

        let poolIdx = 0;
        const allocated: { cand: ScoredCandidate; slotId: string; rank: number; randomDraw: number }[] = [];
        const waitlisted: { cand: ScoredCandidate; rank: number; randomDraw: number }[] = [];

        for (const companyId of [...byCompany.keys()].sort()) {
          const group = byCompany.get(companyId)!;
          const available = await availableQuotaTx(tx, companyId, bookingDate);
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
          allocation: { select: { slot: { select: { slotNumber: true } } } },
        },
      },
    },
  });
  return { run, rows };
}
