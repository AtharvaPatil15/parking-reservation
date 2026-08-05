import { asyncHandler } from '../../lib/asyncHandler';
import { sendSuccess } from '../../lib/response';
import { parsePagination } from '../../lib/pagination';
import { UnauthenticatedError } from '../../lib/errors';
import * as service from './gate.service';

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

type VehicleRow = Awaited<ReturnType<typeof service.searchVehicles>>[number];
type GateEventRow = Awaited<ReturnType<typeof service.listGateEvents>>['rows'][number];
type StampedEvent = Awaited<ReturnType<typeof service.checkIn>>;

/** openapi VehicleSummary — one registry row as the typeahead shows it. */
function toVehicle(v: VehicleRow) {
  return {
    id: v.id,
    vehicleNumber: v.vehicleNumber,
    displayNumber: v.displayNumber,
    ownerName: v.ownerName,
    ownerEmail: v.ownerEmail ?? null,
    contactNumber: v.contactNumber ?? null,
    vehicleType: v.vehicleType,
    makeModel: v.makeModel ?? null,
    colour: v.colour ?? null,
    companyId: v.companyId ?? null,
    companyName: v.company?.name ?? null,
  };
}

/** openapi GateEvent — a visit row for the gate log / unbooked-entry feed. */
function toGateEvent(e: GateEventRow | StampedEvent) {
  return {
    id: e.id,
    vehicleNumber: e.vehicleNumber,
    displayNumber: 'vehicle' in e ? (e.vehicle?.displayNumber ?? e.vehicleNumber) : e.vehicleNumber,
    ownerName: e.ownerNameSnapshot ?? null,
    companyId: e.companyId ?? null,
    companyName: e.company?.name ?? null,
    bookingDate: isoDate(e.bookingDate),
    bookingRequestId: e.bookingRequestId ?? null,
    hadBooking: e.hadBooking,
    status: e.status,
    checkInAt: e.checkInAt.toISOString(),
    checkOutAt: e.checkOutAt ? e.checkOutAt.toISOString() : null,
    notes: e.notes ?? null,
  };
}

export const searchVehicles = asyncHandler(async (req, res) => {
  const rows = await service.searchVehicles(
    (req.query.search as string | undefined) ?? '',
    req.query.limit ? Number(req.query.limit) : undefined,
  );
  sendSuccess(res, rows.map(toVehicle), 200);
});

/** GET /vehicles/lookup?number= — owner + today's booking + open-visit state, from a plate alone. */
export const lookupVehicle = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.lookupVehicle(req.query.number as string), 200);
});

export const checkIn = asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthenticatedError();
  const event = await service.checkIn(req.user.id, req.body);
  // `hadBooking: false` is the signal the drawer turns into "no booking today — recorded anyway".
  sendSuccess(res, toGateEvent(event), 201);
});

export const checkOut = asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthenticatedError();
  sendSuccess(res, toGateEvent(await service.checkOut(req.user.id, req.body)), 200);
});

export const listGateEvents = asyncHandler(async (req, res) => {
  const p = parsePagination(req.query as Record<string, unknown>);
  const { rows, total } = await service.listGateEvents(
    {
      date: req.query.date as string | undefined,
      status: req.query.status as 'CHECKED_IN' | 'CHECKED_OUT' | undefined,
    },
    p,
  );
  sendSuccess(res, rows.map(toGateEvent), 200, { page: p.page, pageSize: p.pageSize, total });
});

/** GET /gate/unbooked — entries with no booking (D16). CA sees own company; SA sees all. */
export const listUnbooked = asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthenticatedError();
  const p = parsePagination(req.query as Record<string, unknown>);
  const { rows, total } = await service.listUnbookedEntries(
    req.user,
    { date: req.query.date as string | undefined, companyId: req.query.companyId as string | undefined },
    p,
  );
  sendSuccess(res, rows.map(toGateEvent), 200, { page: p.page, pageSize: p.pageSize, total });
});

/** GET /gate/capacity — per-company slots/booked/free/inside for a date. The gate's "is there room?". */
export const getCapacity = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.getGateCapacity(req.query.date as string | undefined), 200);
});

type RegistrationRow = Awaited<ReturnType<typeof service.listRegistrations>>['rows'][number];

/** openapi VehicleRegistration — a walk-in request as every screen renders it. */
function toRegistration(r: RegistrationRow) {
  return {
    id: r.id,
    vehicleNumber: r.vehicleNumber,
    displayNumber: r.displayNumber,
    ownerName: r.ownerName,
    ownerEmail: r.ownerEmail ?? null,
    contactNumber: r.contactNumber ?? null,
    companyId: r.companyId,
    companyName: r.company.name,
    vehicleType: r.vehicleType,
    makeModel: r.makeModel ?? null,
    colour: r.colour ?? null,
    notes: r.notes ?? null,
    status: r.status,
    requestedById: r.requestedById ?? null,
    decidedById: r.decidedById ?? null,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    decisionNote: r.decisionNote ?? null,
    vehicleId: r.vehicleId ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export const createRegistration = asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthenticatedError();
  const created = await service.createRegistration(req.user.id, req.body);
  sendSuccess(res, toRegistration(created as RegistrationRow), 201);
});

export const listRegistrations = asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthenticatedError();
  const p = parsePagination(req.query as Record<string, unknown>);
  const { rows, total } = await service.listRegistrations(
    req.user,
    {
      status: req.query.status as 'PENDING' | 'APPROVED' | 'REJECTED' | undefined,
      companyId: req.query.companyId as string | undefined,
    },
    p,
  );
  sendSuccess(res, rows.map(toRegistration), 200, { page: p.page, pageSize: p.pageSize, total });
});

export const decideRegistration = asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthenticatedError();
  const updated = await service.decideRegistration(req.user, req.params.id, req.body);
  sendSuccess(res, toRegistration(updated as RegistrationRow), 200);
});
