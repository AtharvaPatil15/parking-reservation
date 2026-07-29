import { asyncHandler } from '../../lib/asyncHandler';
import { sendSuccess } from '../../lib/response';
import * as service from './allocation.service';

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown) => (v != null ? Number(v) : null);

type Summary = Awaited<ReturnType<typeof service.getRunSummary>>;
type Breakdown = Awaited<ReturnType<typeof service.getRunBreakdown>>;

/** openapi AllocationRunSummary. */
function toRunSummary({ run, totalRequests, allocatedCount, waitlistedCount }: Summary) {
  return {
    id: run.id,
    runType: run.runType,
    bookingDate: isoDate(run.bookingDate),
    status: run.status,
    idempotencyKey: run.idempotencyKey,
    attemptCount: run.attemptCount,
    totalRequests,
    allocatedCount,
    waitlistedCount,
    startedAt: run.startedAt ? run.startedAt.toISOString() : null,
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    error: run.error ?? null,
  };
}

/** openapi AllocationBreakdown — ranked AllocationResultRow[] (rank by finalScore desc for display). */
function toBreakdown({ run, rows }: Breakdown) {
  return {
    runId: run.id,
    bookingDate: isoDate(run.bookingDate),
    status: run.status,
    weights: rows.length
      ? { distanceWeight: Number(rows[0].distanceWeight), carpoolWeight: Number(rows[0].carpoolWeight) }
      : undefined,
    results: rows.map((r, i) => ({
      rank: i + 1,
      bookingId: r.bookingRequest.id,
      userId: r.bookingRequest.userId,
      user: r.bookingRequest.user.fullName,
      distanceKm: num(r.bookingRequest.travelDistanceKm),
      people: r.travellerCount,
      distanceScore: Number(r.distanceScore),
      carpoolScore: Number(r.carpoolScore),
      finalScore: Number(r.finalScore),
      outcome: r.bookingRequest.status === 'ALLOCATED' ? 'ALLOCATED' : 'WAITLISTED',
      slotNumber: r.bookingRequest.allocation?.slot?.slotNumber ?? null,
    })),
  };
}

export const runPrimary = asyncHandler(async (req, res) => {
  const runId = await service.runPrimaryAllocation(req.body.bookingDate, req.user?.id);
  sendSuccess(res, toRunSummary(await service.getRunSummary(runId)), 200);
});

export const getRun = asyncHandler(async (req, res) => {
  sendSuccess(res, toRunSummary(await service.getRunSummary(req.params.id)), 200);
});

export const getBreakdown = asyncHandler(async (req, res) => {
  sendSuccess(res, toBreakdown(await service.getRunBreakdown(req.params.id)), 200);
});
