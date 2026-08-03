import { asyncHandler } from '../../lib/asyncHandler';
import { sendSuccess } from '../../lib/response';
import { parsePagination } from '../../lib/pagination';
import { UnauthenticatedError } from '../../lib/errors';
import * as service from './allocation.service';

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown) => (v != null ? Number(v) : null);

type Summary = Awaited<ReturnType<typeof service.getRunSummary>>;
type Breakdown = Awaited<ReturnType<typeof service.getRunBreakdown>>;
type RosterRow = Awaited<ReturnType<typeof service.listAllocations>>['rows'][number];

/** openapi AllocationRosterItem — one seat and who holds it for the date. */
function toRosterItem(a: RosterRow) {
  return {
    id: a.id,
    slotNumber: a.slot.slotNumber,
    allocationType: a.allocationType,
    bookingDate: isoDate(a.bookingDate),
    employeeName: a.bookingRequest.user.fullName,
    employeeEmail: a.bookingRequest.user.email,
    companyId: a.companyId,
    companyName: a.bookingRequest.company.name,
    allocationScore: num(a.bookingRequest.allocationScore),
  };
}

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
      companyName: r.bookingRequest.company.name,
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

export const runCommonPool = asyncHandler(async (req, res) => {
  const runId = await service.runCommonPoolAllocation(req.body.bookingDate, req.user?.id);
  sendSuccess(res, toRunSummary(await service.getRunSummary(runId)), 200);
});

export const listAllocations = asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthenticatedError();
  const p = parsePagination(req.query as Record<string, unknown>);
  const { rows, total } = await service.listAllocations(
    req.user,
    {
      date: req.query.date as string | undefined,
      companyId: req.query.companyId as string | undefined,
      type: req.query.type as 'PRIMARY' | 'COMMON_POOL' | undefined,
    },
    p,
  );
  sendSuccess(res, rows.map(toRosterItem), 200, { page: p.page, pageSize: p.pageSize, total });
});

export const getRun = asyncHandler(async (req, res) => {
  sendSuccess(res, toRunSummary(await service.getRunSummary(req.params.id)), 200);
});

export const getRunByDate = asyncHandler(async (req, res) => {
  const summary = await service.getRunSummaryByDate(
    req.query.runType as 'PRIMARY' | 'COMMON_POOL',
    req.query.bookingDate as string,
  );
  sendSuccess(res, summary ? toRunSummary(summary) : null, 200);
});

export const getBreakdown = asyncHandler(async (req, res) => {
  sendSuccess(res, toBreakdown(await service.getRunBreakdown(req.params.id)), 200);
});
