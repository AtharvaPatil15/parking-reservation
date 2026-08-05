import { HttpResponse, http } from 'msw';
import { handlers as generated } from './handlers.generated';
import type { components } from '../api/types';

type LoginResponseData = components['schemas']['LoginResponseData'];
type BookingCreatedData = components['schemas']['BookingCreatedData'];
type BookingDetail = components['schemas']['BookingDetail'];
type Booking = components['schemas']['Booking'];
type AdminBooking = components['schemas']['AdminBooking'];
type AllocationRunSummary = components['schemas']['AllocationRunSummary'];
type AllocationBreakdown = components['schemas']['AllocationBreakdown'];
type AllocationRosterItem = components['schemas']['AllocationRosterItem'];
type ConfigEntry = components['schemas']['ConfigEntry'];
type RoleName = components['schemas']['RoleName'];
type UserProfile = components['schemas']['UserProfile'];
type UserDashboard = components['schemas']['UserDashboard'];
type SuperAdminDashboard = components['schemas']['SuperAdminDashboard'];
type CompanyAdminDashboard = components['schemas']['CompanyAdminDashboard'];
type Company = components['schemas']['Company'];
type ParkingSlot = components['schemas']['ParkingSlot'];
type ParkingArea = components['schemas']['ParkingArea'];
type CompanyQuota = components['schemas']['CompanyQuota'];
type CompanyQuotaSummaryEntry = components['schemas']['CompanyQuotaSummaryEntry'];
type SlotBlock = components['schemas']['SlotBlock'];
type CompanySummary = components['schemas']['CompanySummary'];
type RegisterRequest = components['schemas']['RegisterRequest'];
type AvailabilityResponse = components['schemas']['AvailabilityResponse'];
type DayAvailability = components['schemas']['DayAvailability'];
type SlotBox = components['schemas']['SlotBox'];
type BookingWindow = components['schemas']['BookingWindow'];
type WeeklyRunPreview = components['schemas']['WeeklyRunPreview'];
type WeeklyRunResult = components['schemas']['WeeklyRunResult'];
type VehicleSummary = components['schemas']['VehicleSummary'];
type GateLookup = components['schemas']['GateLookup'];
type GateEvent = components['schemas']['GateEvent'];

const baseURL = '/api/v1';
const ok = <T,>(data: T, status = 200) => HttpResponse.json({ success: true, data }, { status });

// Dev-only mock session persisted so a browser refresh survives in mock mode (mirrors the real
// backend's HttpOnly refresh cookie). Never used against a real API — purely a mock artifact.
const MOCK_SESSION_KEY = 'mock:auth';
interface MockSession { id: string; fullName: string; email: string; role: RoleName; companyId: string; companyName: string }
function readMockSession(): MockSession | null {
  try {
    const raw = localStorage.getItem(MOCK_SESSION_KEY);
    return raw ? (JSON.parse(raw) as MockSession) : null;
  } catch {
    return null;
  }
}
function writeMockSession(s: MockSession | null): void {
  try {
    if (s) localStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(MOCK_SESSION_KEY);
  } catch {
    /* storage unavailable */
  }
}
const okPage = <T,>(items: T[], page: number, pageSize: number, total = items.length) =>
  HttpResponse.json({ success: true, data: items, meta: { page, pageSize, total } });
const fail = (status: number, code: string, message: string) =>
  HttpResponse.json({ success: false, error: { code, message } }, { status });

function roleForEmail(email: string): RoleName {
  if (email.startsWith('admin@')) return 'SUPER_ADMIN';
  if (email.startsWith('company@')) return 'COMPANY_ADMIN';
  // Phase 7: `security@…` signs in as a gate operator so the mock demo can reach /security.
  if (email.startsWith('security@')) return 'SECURITY';
  return 'USER';
}

// ---------------------------------------------------------------------------
// Seed factories. Each returns fresh objects so `resetMockData()` can restore a
// clean slate between tests (the store below is mutated by release / PATCH /
// approval / create handlers to keep the demo coherent — branch-2 note L1).
// ---------------------------------------------------------------------------

/** Config keyed by the REAL backend keys (config.service.ts), so the same screen
 *  drives MSW and the live API after P5-13. Times satisfy the D8 ordering rule
 *  primaryCutoff < primaryResultsBy <= commonPoolClose < commonPoolResultsBy. */
function seedConfig(): ConfigEntry[] {
  return [
    { key: 'booking.primaryCutoff', value: '13:00', valueType: 'TIME', description: 'Primary window closes' },
    { key: 'booking.primaryResultsBy', value: '14:00', valueType: 'TIME', description: 'Primary results published by' },
    { key: 'booking.commonPoolClose', value: '16:00', valueType: 'TIME', description: 'Common-pool window closes' },
    { key: 'booking.commonPoolResultsBy', value: '17:00', valueType: 'TIME', description: 'Common-pool results published by' },
    { key: 'allocation.distanceWeight', value: '0.6', valueType: 'NUMBER', description: 'Weight of the distance sub-score (0–1)' },
    { key: 'allocation.carpoolWeight', value: '0.4', valueType: 'NUMBER', description: 'Weight of the carpool sub-score (0–1)' },
    { key: 'allocation.maxDistanceKm', value: '40', valueType: 'NUMBER', description: 'Distance cap for scoring (km)' },
    { key: 'carpool.maxPeople', value: '4', valueType: 'NUMBER', description: 'Max people per carpool' },
    { key: 'booking.reminderBefore', value: '120', valueType: 'NUMBER', description: 'Reminder lead time (minutes)' },
    { key: 'password.minLength', value: '8', valueType: 'NUMBER', description: 'Minimum password length' },
    // Phase 7 — rolling window + weekly weekend run.
    { key: 'booking.windowWeeks', value: '2', valueType: 'NUMBER', description: 'How many weeks ahead booking is open (2 or 4)' },
    { key: 'booking.allocationRunFrequency', value: 'WEEKLY', valueType: 'STRING', description: 'Automatic allocation run interval' },
    { key: 'booking.allocationRunDay', value: 'SUNDAY', valueType: 'STRING', description: 'Weekly allocation run day' },
    { key: 'booking.allocationRunTime', value: '20:00', valueType: 'TIME', description: 'Weekly allocation run time (IST)' },
    { key: 'booking.approvalLeadDays', value: '3', valueType: 'NUMBER', description: 'Days a date is decided ahead of itself' },
  ];
}

const breakdownFor = (distanceKm: number, people: number, finalScore: number) => ({
  distanceKm,
  people,
  distanceScore: 42.5,
  carpoolScore: 33.3,
  distanceWeight: 0.6,
  carpoolWeight: 0.4,
  finalScore,
});

/** Bookings keyed by id, coherent with the /me/bookings list and the dashboard's
 *  upcoming booking. Past-dated rows are resolved (never WAITLISTED — KI-2), and
 *  the detail for an id matches the list row you clicked from (KI-3). */
function seedBookings(): Record<string, BookingDetail> {
  return {
    'mock-booking-1': {
      id: 'mock-booking-1', bookingDate: MOCK_UPCOMING_DATE, bookingType: 'PRIMARY', status: 'ALLOCATED',
      travelDistanceKm: 8.5, vehicleType: 'CAR', vehicleNumber: 'KA-01-1234', carpoolMemberCount: 2,
      specialRequirement: null, allocationScore: 47.2, allocatedSlotNumber: 'A-12',
      submittedAt: '2026-07-29T09:00:00.000Z', createdAt: '2026-07-29T08:00:00.000Z',
      carpoolMembers: [{ id: 'm1', name: 'Sam Lee', employeeEmail: 'sam@acme.test', sameCompany: true, isScored: true }],
      scoreBreakdown: breakdownFor(8.5, 2, 38.8),
    },
    'bk-1': {
      id: 'bk-1', bookingDate: MOCK_UPCOMING_DATE, bookingType: 'PRIMARY', status: 'ALLOCATED',
      travelDistanceKm: 8.5, vehicleType: 'CAR', vehicleNumber: 'KA-01-1234', carpoolMemberCount: 2,
      specialRequirement: null, allocationScore: 47.2, allocatedSlotNumber: 'A-12',
      submittedAt: '2026-07-29T09:00:00.000Z', createdAt: '2026-07-29T08:00:00.000Z',
      carpoolMembers: [{ id: 'm1', name: 'Sam Lee', employeeEmail: 'sam@acme.test', sameCompany: true, isScored: true }],
      scoreBreakdown: breakdownFor(8.5, 2, 38.8),
    },
    // Past date, waitlisted request that lapsed at cutoff → REJECTED (never left as
    // WAITLISTED; KI-2). Scored, but no slot, so the detail offers no release (KI-1).
    'bk-2': {
      id: 'bk-2', bookingDate: '2026-07-28', bookingType: 'PRIMARY', status: 'REJECTED',
      travelDistanceKm: 5.1, vehicleType: 'CAR', vehicleNumber: 'KA-02-5678', carpoolMemberCount: 1,
      specialRequirement: null, allocationScore: 22.4, allocatedSlotNumber: null,
      submittedAt: '2026-07-25T09:00:00.000Z', createdAt: '2026-07-25T08:00:00.000Z',
      carpoolMembers: [], scoreBreakdown: breakdownFor(5.1, 1, 22.4),
    },
    'bk-3': {
      id: 'bk-3', bookingDate: '2026-07-21', bookingType: 'COMMON_POOL', status: 'RELEASED',
      travelDistanceKm: 3.2, vehicleType: 'BIKE', vehicleNumber: 'KA-03-9012', carpoolMemberCount: 1,
      specialRequirement: null, allocationScore: null, allocatedSlotNumber: null,
      submittedAt: '2026-07-18T09:00:00.000Z', createdAt: '2026-07-18T08:00:00.000Z',
      carpoolMembers: [],
    },
    // Far-future, still-SUBMITTED request → always editable (drives the edit-carpool flow).
    // Fixed well ahead of now so BookingStatus's isTodayOrFuture edit gate never lapses,
    // keeping the demo/screenshots stable over time.
    'bk-4': {
      id: 'bk-4', bookingDate: '2099-12-31', bookingType: 'PRIMARY', status: 'SUBMITTED',
      travelDistanceKm: 6.0, vehicleType: 'CAR', vehicleNumber: 'KA-04-3456', carpoolMemberCount: 1,
      specialRequirement: null, allocationScore: null, allocatedSlotNumber: null,
      submittedAt: '2026-07-30T09:00:00.000Z', createdAt: '2026-07-30T08:00:00.000Z',
      carpoolMembers: [{ id: 'm4', name: 'Existing Member', employeeEmail: 'exist@mock.test', sameCompany: true, isScored: false }],
    },
  };
}

/** History list order (newest first). */
const HISTORY_IDS = ['bk-4', 'bk-1', 'bk-2', 'bk-3'] as const;

/** Admin booking roster (GET /bookings) — who booked, for what date, across companies. */
function seedAdminBookings(): AdminBooking[] {
  const row = (
    id: string, employeeName: string, employeeEmail: string, companyId: string, companyName: string,
    bookingDate: string, status: AdminBooking['status'], slot: string | null, distance: number, people: number, score: number | null,
  ): AdminBooking => ({
    id, bookingDate, bookingType: 'PRIMARY', status, employeeName, employeeEmail, companyId, companyName,
    allocationSource: status === 'ALLOCATED' ? 'PRIMARY' : null,
    travelDistanceKm: distance, carpoolPeople: people, allocationScore: score, allocatedSlotNumber: slot,
    carpoolMembers: Array.from({ length: Math.max(0, people - 1) }, (_v, i) => ({
      id: `${id}-member-${i + 1}`,
      name: `Passenger ${i + 1}`,
      employeeEmail: `passenger${i + 1}@mock.test`,
      contactNumber: `999000000${i + 1}`,
      pickupLocation: `Pickup ${i + 1}`,
      sameCompany: true,
      isScored: true,
    })),
    submittedAt: '2026-07-29T09:00:00.000Z', createdAt: '2026-07-29T08:00:00.000Z',
  });
  const dPrimary = {
    ...row('ab-5-primary', 'D User', 'd@mock.test', 'mock-co', 'Mock Co', '2026-08-03', 'ALLOCATED', 'A-14', 1.5, 1, 1.5),
    allocationSource: 'RELEASED_SLOT' as const,
  };
  const dCommonPool = {
    ...row('ab-5-cp', 'D User', 'd@mock.test', 'mock-co', 'Mock Co', '2026-08-03', 'WAITLISTED', null, 1.5, 1, 1.5),
    bookingType: 'COMMON_POOL' as const,
  };
  return [
    row('ab-1', 'Priya Rao', 'priya@mock.test', 'mock-co', 'Mock Co', '2026-08-03', 'ALLOCATED', 'A-12', 2.4, 3, 47.2),
    row('ab-2', 'Sam Lee', 'sam@mock.test', 'mock-co', 'Mock Co', '2026-08-03', 'ALLOCATED', 'A-13', 5.1, 2, 35.3),
    row('ab-3', 'Lee Chen', 'lee@mock.test', 'mock-co', 'Mock Co', '2026-08-03', 'WAITLISTED', null, 8.7, 1, 26.1),
    {
      ...dPrimary,
      history: [dPrimary, dCommonPool],
    },
    row('ab-4', 'Dana Ford', 'dana@acme.test', 'co-acme', 'Acme Corp', '2026-08-04', 'SUBMITTED', null, 3.3, 1, null),
  ];
}

/** Allocated-seat roster (GET /allocations) — which slot is held by whom, primary vs common pool. */
function seedAllocations(): AllocationRosterItem[] {
  const row = (
    id: string, slotNumber: string, allocationType: AllocationRosterItem['allocationType'],
    employeeName: string, employeeEmail: string, companyId: string, companyName: string,
    bookingDate: string, score: number | null,
  ): AllocationRosterItem => ({
    id, slotNumber, allocationType, bookingDate, employeeName, employeeEmail, companyId, companyName,
    allocationScore: score,
  });
  return [
    row('al-1', 'A-12', 'PRIMARY', 'Priya Rao', 'priya@mock.test', 'mock-co', 'Mock Co', '2026-08-03', 47.2),
    row('al-2', 'A-13', 'PRIMARY', 'Sam Lee', 'sam@mock.test', 'mock-co', 'Mock Co', '2026-08-03', 35.3),
    row('al-3', 'B-04', 'COMMON_POOL', 'Lee Chen', 'lee@mock.test', 'mock-co', 'Mock Co', '2026-08-03', 26.1),
    row('al-4', 'C-01', 'COMMON_POOL', 'Dana Ford', 'dana@acme.test', 'co-acme', 'Acme Corp', '2026-08-03', 22.0),
  ];
}

function toSummary(d: BookingDetail): Booking {
  return {
    id: d.id,
    bookingDate: d.bookingDate,
    bookingType: d.bookingType,
    status: d.status,
    carpoolMemberCount: d.carpoolMemberCount,
    allocatedSlotNumber: d.allocatedSlotNumber ?? undefined,
    createdAt: d.createdAt,
  };
}

function seedCompanies(): Company[] {
  return [
    { id: 'mock-co', name: 'Mock Co', code: 'MOCK', status: 'ACTIVE', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z' },
    { id: 'co-acme', name: 'Acme Corp', code: 'ACME', status: 'ACTIVE', createdAt: '2026-06-02T00:00:00.000Z', updatedAt: '2026-07-02T00:00:00.000Z' },
    { id: 'co-globex', name: 'Globex', code: 'GLBX', status: 'INACTIVE', createdAt: '2026-06-03T00:00:00.000Z', updatedAt: '2026-07-03T00:00:00.000Z' },
  ];
}

function userProfile(
  id: string, fullName: string, email: string, status: UserProfile['status'], role: RoleName = 'USER',
  company: { id: string; name: string } = { id: 'mock-co', name: 'Mock Co' },
): UserProfile {
  return {
    id, fullName, email, contactNumber: '555-0100', address: '1 Main St', pinCode: '560001',
    distanceKm: 8.5, status, emailVerified: true, companyId: company.id, companyName: company.name,
    role, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z',
  };
}

/** Company users keyed by companyId (for approvals + company user lists). */
function seedCompanyUsers(): Record<string, UserProfile[]> {
  const acme = { id: 'co-acme', name: 'Acme Corp' };
  return {
    'mock-co': [
      userProfile('u-priya', 'Priya Rao', 'priya@mock.test', 'ACTIVE'),
      userProfile('u-sam', 'Sam Lee', 'sam@mock.test', 'ACTIVE'),
      userProfile('u-nadia', 'Nadia Khan', 'nadia@mock.test', 'PENDING'),
      userProfile('u-omar', 'Omar Diaz', 'omar@mock.test', 'PENDING'),
      userProfile('u-tess', 'Tess Vaughn', 'tess@mock.test', 'REJECTED'),
    ],
    // Acme users. Two ACTIVE members let cross-company carpooling be exercised: a
    // mock-co user may bring an Acme employee, since carpool members can be any
    // registered user. Blair is a pending company-admin registration (F11) that
    // surfaces in the Super Admin's admin-request queue.
    'co-acme': [
      userProfile('u-ivy', 'Ivy Chen', 'ivy@acme.test', 'ACTIVE', 'USER', acme),
      userProfile('u-raj', 'Raj Patel', 'raj@acme.test', 'ACTIVE', 'USER', acme),
      userProfile('u-blair', 'Blair Ng', 'blair@acme.test', 'PENDING', 'COMPANY_ADMIN', acme),
      userProfile('u-guard', 'Gate Guard', 'guard@acme.test', 'ACTIVE', 'SECURITY', acme),
    ],
  };
}

function seedSlots(): ParkingSlot[] {
  const mk = (n: number, type: ParkingSlot['slotType'], status: ParkingSlot['status']): ParkingSlot => ({
    id: `slot-${n}`, slotNumber: `A-${String(n).padStart(2, '0')}`, parkingAreaId: 'area-1',
    slotType: type, status, hasEvCharging: type === 'EV_CHARGING', isAccessible: type === 'ACCESSIBLE',
    createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
  });
  return [
    mk(12, 'STANDARD', 'AVAILABLE'),
    mk(13, 'STANDARD', 'BOOKED'),
    mk(14, 'EV_CHARGING', 'AVAILABLE'),
    mk(15, 'ACCESSIBLE', 'BLOCKED'),
    mk(16, 'STANDARD', 'COMMON_POOL'),
  ];
}

/** Quota rows keyed by companyId. */
function seedQuota(): Record<string, CompanyQuota[]> {
  return {
    'mock-co': [
      { id: 'q-1', companyId: 'mock-co', slotCount: 20, effectiveFrom: '2026-07-01', effectiveTo: null, createdAt: '2026-06-20T00:00:00.000Z' },
    ],
    'co-acme': [
      { id: 'q-2', companyId: 'co-acme', slotCount: 15, effectiveFrom: '2026-07-01', effectiveTo: null, createdAt: '2026-06-20T00:00:00.000Z' },
    ],
  };
}

/** Quota blocks keyed by companyId. */
function seedBlocks(): Record<string, SlotBlock[]> {
  return {
    'mock-co': [
      { id: 'blk-1', companyId: 'mock-co', blockedCount: 3, startDate: '2026-08-01', endDate: '2026-08-05', reason: 'COMPANY_EVENT', reasonText: 'Quarterly offsite', createdAt: '2026-07-20T00:00:00.000Z' },
    ],
  };
}

/** Parking areas the super admin can allocate slots into (Basement 1/2/3), extendable via POST. */
function seedParkingAreas(): ParkingArea[] {
  return [
    { id: 'area-1', name: 'Basement 1', floor: 'B1', officeLocationId: 'office-1' },
    { id: 'area-2', name: 'Basement 2', floor: 'B2', officeLocationId: 'office-1' },
    { id: 'area-3', name: 'Basement 3', floor: 'B3', officeLocationId: 'office-1' },
  ];
}

// ---------------------------------------------------------------------------
// Phase 7 — booking window / slot grid + gate (security persona).
//
// Dates are derived from "today" rather than hardcoded, so the mock window is always open and the
// demo never goes stale. The maths mirrors backend `bookings.window.ts`: the batch runs on Sunday at
// 20:00, a date is decided `LEAD_DAYS` ahead of itself, and requests are open from the next run's
// date + lead until today + WINDOW_WEEKS*7.
// ---------------------------------------------------------------------------

const MOCK_QUOTA = 12; // matches the seeded Assent quota, so the grid shows the 12 boxes of the spec
const LEAD_DAYS = 3;
const WINDOW_WEEKS = 2;

const isoOf = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDaysTo = (d: Date, n: number): Date => {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
};
/**
 * The demo's "upcoming allocated booking" date: today if it is a weekday, else the next Monday.
 *
 * Relative rather than a literal, because `BookingStatus` only offers **Release** for a booking dated
 * today or later. A hardcoded date silently expires at midnight and takes the release affordance with
 * it — which reads as a broken feature rather than a stale fixture, and cost a red suite once already.
 * Exported so a test can assert the same value instead of re-deriving it.
 */
export const MOCK_UPCOMING_DATE: string = (() => {
  let d = new Date();
  // getDay(): 0 = Sunday, 6 = Saturday.
  while (d.getDay() === 0 || d.getDay() === 6) d = addDaysTo(d, 1);
  return isoOf(d);
})();

const isWeekday = (iso: string): boolean => {
  const day = new Date(`${iso}T00:00:00`).getDay();
  return day >= 1 && day <= 5;
};

/** Next Sunday 20:00 local, strictly after now (a run happening now belongs to this week). */
function mockNextRun(now = new Date()): Date {
  const run = new Date(now);
  run.setHours(20, 0, 0, 0);
  const delta = (0 - run.getDay() + 7) % 7; // 0 = Sunday
  run.setDate(run.getDate() + delta);
  if (run.getTime() <= now.getTime()) run.setDate(run.getDate() + 7);
  return run;
}

/** Live scoring inputs (§4/D3) read from the mutable config store, so P8-12's score panel reacts to
 *  Super-Admin edits the same way the real `bookingWindowSummary` would. */
function mockScoring(): { distanceWeight: number; carpoolWeight: number; maxDistanceKm: number; maxPeople: number } {
  const num = (key: string, fallback: number) => Number(configState.find((c) => c.key === key)?.value ?? fallback);
  return {
    distanceWeight: num('allocation.distanceWeight', 0.6),
    carpoolWeight: num('allocation.carpoolWeight', 0.4),
    maxDistanceKm: num('allocation.maxDistanceKm', 40),
    maxPeople: num('carpool.maxPeople', 4),
  };
}

function mockWindow(now = new Date()): BookingWindow {
  const nextRun = mockNextRun(now);
  const earliest = addDaysTo(nextRun, LEAD_DAYS);
  const latest = addDaysTo(now, WINDOW_WEEKS * 7);
  const dates: string[] = [];
  for (let d = new Date(earliest); d.getTime() <= latest.getTime(); d = addDaysTo(d, 1)) {
    if (isWeekday(isoOf(d))) dates.push(isoOf(d));
  }
  return {
    nextRunAt: nextRun.toISOString(),
    nextRunCountdownSeconds: Math.max(0, Math.floor((nextRun.getTime() - now.getTime()) / 1000)),
    requestCloseAt: new Date(nextRun.getFullYear(), nextRun.getMonth(), nextRun.getDate(), 19, 0, 0, 0).toISOString(),
    requestCloseCountdownSeconds: Math.max(
      0,
      Math.floor((new Date(nextRun.getFullYear(), nextRun.getMonth(), nextRun.getDate(), 19, 0, 0, 0).getTime() - now.getTime()) / 1000),
    ),
    resultsRunAt: nextRun.toISOString(),
    runDay: 'SUNDAY',
    runFrequency: 'WEEKLY',
    runTime: '20:00',
    windowWeeks: WINDOW_WEEKS,
    approvalLeadDays: LEAD_DAYS,
    earliestDate: isoOf(earliest),
    latestDate: isoOf(latest),
    requestableDates: dates,
    nextRuns: Array.from({ length: 5 }, (_, i) => addDaysTo(nextRun, i * 7).toISOString()),
    scoring: mockScoring(),
  };
}

/**
 * Phase 8 (D22): before a date's run, the grid shows only AVAILABLE/BLOCKED — requests never take a
 * box (D18). `blocked` first so the count is stable regardless of quota, then AVAILABLE fills the rest.
 */
function buildOpenBoxes(quota: number, blocked: number): SlotBox[] {
  const boxes: SlotBox[] = [];
  for (let i = 0; i < blocked; i++) boxes.push({ index: 0, state: 'BLOCKED', slotNumber: null });
  while (boxes.length < quota) boxes.push({ index: 0, state: 'AVAILABLE', slotNumber: null });
  return boxes.slice(0, quota).map((b, i) => ({ ...b, index: i + 1 }));
}

/**
 * After the run: MINE first (so it survives the clamp — mirrors the backend's "own box first" rule),
 * then everyone else's TAKEN allocations with their real slot numbers, then BLOCKED, then whatever
 * AVAILABLE remains.
 */
/** Mock slot labels match the real `ParkingSlot.slotNumber` format — a free-form label, not an ordinal. */
const slotLabel = (n: number): string => `A-${String(n).padStart(2, '0')}`;

function buildDecidedBoxes(quota: number, blocked: number, otherSlots: string[], mySlot: string | null): SlotBox[] {
  const boxes: SlotBox[] = [];
  if (mySlot !== null) boxes.push({ index: 0, state: 'MINE', slotNumber: mySlot });
  for (const slot of otherSlots) boxes.push({ index: 0, state: 'TAKEN', slotNumber: slot });
  for (let i = 0; i < blocked; i++) boxes.push({ index: 0, state: 'BLOCKED', slotNumber: null });
  while (boxes.length < quota) boxes.push({ index: 0, state: 'AVAILABLE', slotNumber: null });
  return boxes.slice(0, quota).map((b, i) => ({ ...b, index: i + 1 }));
}

/**
 * Per-date state the mock mutates as requests are submitted and (via `setMockDatePhase`) decided.
 * `requestCount` is demand only — it never gates a submission (D18). `decided` drives `phase`; once
 * true, `otherSlots`/`mySlotNumber` describe the real allocation the grid renders.
 */
interface MockDayState {
  requestCount: number;
  blocked: number;
  decided: boolean;
  myStatus: DayAvailability['myStatus'];
  mySlotNumber: string | null;
  otherSlots: string[];
  /** True once the band's common-pool run has covered this date. Separate from `decided` — the two
   *  runs are separate steps, and a date can be decided but not yet pooled. */
  pooled?: boolean;
}

/** Slots the date's primary run handed out, and who it left behind. Shared by the preview and both runs. */
function mockDayCounts(st: MockDayState | undefined): { allocated: number; waitlisted: number } {
  if (!st || !st.decided) return { allocated: 0, waitlisted: 0 };
  const allocated = st.otherSlots.length + (st.myStatus === 'ALLOCATED' ? 1 : 0);
  return { allocated, waitlisted: Math.max(0, st.requestCount - allocated) };
}

function seedAvailability(): Record<string, MockDayState> {
  const win = mockWindow();
  const state: Record<string, MockDayState> = {};
  win.requestableDates.forEach((date, i) => {
    if (i === 0) {
      // Already decided (demoable pre-built outcome): the caller won a slot.
      state[date] = {
        requestCount: MOCK_QUOTA - 1, blocked: 0, decided: true,
        myStatus: 'ALLOCATED', mySlotNumber: slotLabel(3),
        otherSlots: [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12].slice(0, MOCK_QUOTA - 1).map(slotLabel),
      };
    } else if (i === 1) {
      // Already decided: the caller lost out to score and was waitlisted.
      state[date] = {
        requestCount: MOCK_QUOTA + 2, blocked: 0, decided: true,
        myStatus: 'WAITLISTED', mySlotNumber: null,
        otherSlots: Array.from({ length: MOCK_QUOTA }, (_v, n) => slotLabel(n + 1)),
      };
    } else if (i === 2) {
      // Still OPEN, with two boxes withheld by an admin.
      state[date] = { requestCount: 4, blocked: 2, decided: false, myStatus: null, mySlotNumber: null, otherSlots: [] };
    } else {
      // A spread of demand so the count is visibly interesting, all still OPEN.
      state[date] = { requestCount: i % 5, blocked: 0, decided: false, myStatus: null, mySlotNumber: null, otherSlots: [] };
    }
  });
  return state;
}

/**
 * Mock-only dev/test toggle (P8-10): flips a date between the `OPEN` and `DECIDED` grid phases so the
 * frontend can be built and exercised against the two-phase model without a real backend run. Optionally
 * sets the caller's own outcome for the date at the same time. No-op for a date outside the seeded window.
 */
export function setMockDatePhase(
  date: string,
  phase: 'OPEN' | 'DECIDED',
  outcome?: { myStatus?: DayAvailability['myStatus']; mySlotNumber?: string | null; otherSlots?: string[] },
): void {
  const st = availabilityState[date];
  if (!st) return;
  st.decided = phase === 'DECIDED';
  if (outcome?.myStatus !== undefined) st.myStatus = outcome.myStatus;
  if (outcome?.mySlotNumber !== undefined) st.mySlotNumber = outcome.mySlotNumber;
  if (outcome?.otherSlots !== undefined) st.otherSlots = outcome.otherSlots;
}

function seedVehicles(): VehicleSummary[] {
  return [
    { id: 'veh-1', vehicleNumber: 'MH12AB1234', displayNumber: 'MH 12 AB 1234', ownerName: 'Aditi Rao', ownerEmail: 'aditi@assent.example', contactNumber: '9822001101', vehicleType: 'CAR', makeModel: 'Hyundai i20', colour: 'White', companyId: 'mock-co', companyName: 'Mock Co' },
    { id: 'veh-2', vehicleNumber: 'MH12CD5678', displayNumber: 'MH 12 CD 5678', ownerName: 'Rahul Mehta', ownerEmail: 'rahul@assent.example', contactNumber: '9822001102', vehicleType: 'CAR', makeModel: 'Tata Nexon', colour: 'Blue', companyId: 'mock-co', companyName: 'Mock Co' },
    { id: 'veh-3', vehicleNumber: 'MH14EF9012', displayNumber: 'MH 14 EF 9012', ownerName: 'Sara Khan', ownerEmail: 'sara@assent.example', contactNumber: '9822001103', vehicleType: 'EV_CAR', makeModel: 'Tata Nexon EV', colour: 'Grey', companyId: 'mock-co', companyName: 'Mock Co' },
    { id: 'veh-mine-1', vehicleNumber: 'KA011234', displayNumber: 'KA 01 1234', ownerName: 'Mock User', ownerEmail: 'user@acme.test', contactNumber: '9000000000', vehicleType: 'CAR', makeModel: 'Honda City', colour: 'Silver', companyId: 'mock-co', companyName: 'Mock Co' },
  ];
}

/** Same normalization as backend `lib/plate.ts` — spacing/case must not change the answer. */
const normalizeMockPlate = (raw: string): string => raw.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The half-open band the next run owns: `[nextRun + lead, nextRun + 7 + lead)`. */
function mockBand(win: BookingWindow): { from: string; toExclusive: string; dates: string[] } {
  const nextRun = new Date(win.nextRunAt);
  const from = isoOf(addDaysTo(nextRun, LEAD_DAYS));
  const toExclusive = isoOf(addDaysTo(nextRun, 7 + LEAD_DAYS));
  const dates: string[] = [];
  for (let d = new Date(`${from}T00:00:00`); isoOf(d) < toExclusive; d = addDaysTo(d, 1)) {
    if (isWeekday(isoOf(d))) dates.push(isoOf(d));
  }
  return { from, toExclusive, dates };
}

/** Cars with a booking today — drives `hasBooking`, i.e. whether the gate warns (D16). */
const bookedTodayPlates = new Set(['MH12AB1234']);

function seedGateEvents(): GateEvent[] {
  return [];
}

// --- Mutable demo state (reset via resetMockData) ---
let configState = seedConfig();
let bookingState = seedBookings();
let companyState = seedCompanies();
let companyUserState = seedCompanyUsers();
let slotState = seedSlots();
let quotaState = seedQuota();
let blockState = seedBlocks();
let parkingAreaState = seedParkingAreas();
let availabilityState = seedAvailability();
let vehicleState = seedVehicles();
let gateEventState = seedGateEvents();
let profileState: Record<string, Partial<UserProfile>> = {};
let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

function currentMockProfile(): UserProfile {
  const s = readMockSession();
  if (s) {
    const base = userProfile(s.id, s.fullName, s.email, 'ACTIVE', s.role, { id: s.companyId, name: s.companyName });
    return { ...base, ...profileState[s.id] };
  }
  const base = userProfile('mock-user', 'Mock User', 'user@acme.test', 'ACTIVE');
  return { ...base, ...profileState[base.id] };
}

/** Restore all mutable mock state to its seed. Call between tests (see test/setup.ts). */
export function resetMockData(): void {
  configState = seedConfig();
  bookingState = seedBookings();
  companyState = seedCompanies();
  companyUserState = seedCompanyUsers();
  slotState = seedSlots();
  quotaState = seedQuota();
  blockState = seedBlocks();
  parkingAreaState = seedParkingAreas();
  availabilityState = seedAvailability();
  vehicleState = seedVehicles();
  gateEventState = seedGateEvents();
  profileState = {};
  seq = 0;
}

const pageParams = (request: Request) => {
  const url = new URL(request.url);
  return { page: Number(url.searchParams.get('page') ?? '1'), pageSize: Number(url.searchParams.get('pageSize') ?? '10') };
};

/**
 * Every registered user's email, across all companies (case-insensitive). Carpool
 * members must be existing users — but not necessarily same-company — so this spans
 * the whole directory. Stands in for a backend user-lookup the frozen contract does
 * not expose to the USER role.
 */
const directoryEmails = (): Set<string> =>
  new Set(Object.values(companyUserState).flatMap((list) => list.map((u) => u.email.toLowerCase())));

/**
 * Carpool members must be existing users (any company). Every member needs an email, and it must
 * resolve to a registered user — both cases come back as per-member field details so the form can flag
 * the exact row. Shared by the single-date and batch booking handlers so they cannot disagree.
 */
const carpoolMemberDetails = (
  members: { name?: string; employeeEmail?: string }[] | undefined,
): { field: string; message: string }[] => {
  const dir = directoryEmails();
  return (members ?? []).flatMap((m, i) => {
    const email = m.employeeEmail?.trim();
    if (!email) return [{ field: `carpoolMembers.${i}.employeeEmail`, message: 'Email is required.' }];
    if (!dir.has(email.toLowerCase())) {
      return [{ field: `carpoolMembers.${i}.employeeEmail`, message: 'No registered user has this email.' }];
    }
    return [];
  });
};

/** Coherent, deterministic handlers for the hero + admin flows (override the generated random ones). */
const hero = [
  // --- Auth ---
  http.post(`${baseURL}/auth/login`, async ({ request }) => {
    const body = (await request.json().catch(() => null)) as { email?: string; password?: string } | null;
    if (!body?.email || !body?.password) return fail(401, 'UNAUTHENTICATED', 'Invalid credentials');
    const role = roleForEmail(body.email);
    const user = {
      id: `mock-${role.toLowerCase()}`,
      fullName: `Mock ${role.replace('_', ' ')}`,
      role,
      companyId: 'mock-co',
      companyName: 'Mock Co',
    };
    // Persist so a page refresh can rehydrate (via /auth/refresh + /me) in mock mode.
    writeMockSession({ ...user, email: body.email });
    return ok<LoginResponseData>({ accessToken: 'mock-access-token', tokenType: 'Bearer', expiresIn: 900, user });
  }),
  // Rehydrate the access token from the persisted mock session (mirrors the real refresh-cookie flow).
  http.post(`${baseURL}/auth/refresh`, () => {
    const stored = readMockSession();
    if (!stored) return fail(401, 'UNAUTHENTICATED', 'No refresh token');
    return ok<LoginResponseData>({
      accessToken: 'mock-access-token',
      tokenType: 'Bearer',
      expiresIn: 900,
      user: {
        id: stored.id,
        fullName: stored.fullName,
        role: stored.role,
        companyId: stored.companyId,
        companyName: stored.companyName,
      },
    });
  }),
  http.post(`${baseURL}/auth/logout`, () => {
    writeMockSession(null);
    return ok({ message: 'Signed out' });
  }),
  http.get(`${baseURL}/companies/active`, () =>
    ok<CompanySummary[]>(companyState.filter((c) => c.status === 'ACTIVE').map((c) => ({ id: c.id, name: c.name }))),
  ),
  http.post(`${baseURL}/auth/register`, async ({ request }) => {
    const b = (await request.json().catch(() => ({}))) as Partial<RegisterRequest>;
    const isSecurity = b.registrationType === 'SECURITY';
    // A SECURITY applicant (Phase 7 D15) picks no company — the server assigns the building one — so
    // companyId is only required of everyone else.
    if (!b.fullName || !b.email || !b.password || (!isSecurity && !b.companyId)) {
      return fail(400, 'VALIDATION_ERROR', 'Missing required fields');
    }
    if (b.password !== b.confirmPassword) return fail(400, 'VALIDATION_ERROR', 'Passwords do not match');
    const exists = Object.values(companyUserState).some((list) => list.some((u) => u.email === b.email));
    if (exists) return fail(409, 'CONFLICT', 'An account with this email already exists');
    // Mirrors auth.service: match the building company by code. The mock fixture has no REDBRICKS row,
    // so the first ACTIVE company stands in for it.
    const company = isSecurity
      ? (companyState.find((c) => c.code === 'REDBRICKS' && c.status === 'ACTIVE') ??
        companyState.find((c) => c.status === 'ACTIVE'))
      : companyState.find((c) => c.id === b.companyId && c.status === 'ACTIVE');
    if (!company) return fail(400, 'VALIDATION_ERROR', 'Company must be active');
    // Create as PENDING and add to the company's user list. A COMPANY_ADMIN request (F11) gets the
    // COMPANY_ADMIN role so it surfaces in the Super Admin's admin-request queue instead; a SECURITY
    // request lands in the same queue (both are super-admin approved).
    const role: RoleName = isSecurity
      ? 'SECURITY'
      : b.registrationType === 'COMPANY_ADMIN'
        ? 'COMPANY_ADMIN'
        : 'USER';
    const user: UserProfile = {
      ...userProfile(nextId('u'), b.fullName, b.email, 'PENDING', role, { id: company.id, name: company.name }),
      contactNumber: b.contactNumber ?? '—',
      // Not collected for a guard, matching the server (which stores an empty string).
      address: isSecurity ? '' : (b.address ?? '—'),
      pinCode: isSecurity ? '' : (b.pinCode ?? '—'),
      distanceKm: isSecurity ? null : (b.distanceKm ?? null),
    };
    companyUserState[company.id] = [...(companyUserState[company.id] ?? []), user];
    return ok<UserProfile>(user, 201);
  }),

  // --- User bookings ---
  http.post(`${baseURL}/bookings`, async ({ request }) => {
    const b = (await request.json().catch(() => ({}))) as {
      bookingDate?: string;
      carpoolPeople?: number;
      carpoolMembers?: { name?: string; employeeEmail?: string }[];
    };
    const details = carpoolMemberDetails(b.carpoolMembers);
    if (details.length > 0) {
      return HttpResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Some carpool members are not registered users.', details } },
        { status: 400 },
      );
    }
    // Phase 8 D18: a request is a queue entry, not a reservation. It never consumes capacity and can
    // never fail for fullness — only a closed window or a duplicate stop it (mirrors the real server).
    const date = b.bookingDate ?? isoOf(new Date());
    const day = availabilityState[date];
    if (day) {
      if (day.decided) {
        return fail(422, 'WINDOW_CLOSED', `Allocation for ${date} has already run — this date is closed`);
      }
      if (day.myStatus !== null) return fail(409, 'CONFLICT', 'You already have a PRIMARY booking for this date');
      day.requestCount += 1;
      day.myStatus = 'SUBMITTED';
    }
    return ok<BookingCreatedData>(
      {
        id: 'mock-booking-1',
        status: 'SUBMITTED',
        bookingType: 'PRIMARY',
        bookingDate: date,
        travelDistanceKm: 6.2,
        carpoolPeople: b.carpoolPeople ?? 1,
        submittedAt: new Date().toISOString(),
      },
      201,
    );
  }),
  /**
   * POST /bookings/batch — one request per date, shared trip details.
   *
   * Mirrors the server's partial-success contract: always 200, each date evaluated independently
   * against the same stateful grid the single-date handler mutates, so the mock demo can actually show
   * "3 of 5 booked". Request-level member validation is rejected as 400 before any date is booked.
   */
  http.post(`${baseURL}/bookings/batch`, async ({ request }) => {
    const b = (await request.json().catch(() => ({}))) as {
      bookingDates?: string[];
      carpoolPeople?: number;
      carpoolMembers?: { name?: string; employeeEmail?: string }[];
    };
    const details = carpoolMemberDetails(b.carpoolMembers);
    if (details.length > 0) {
      return HttpResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Some carpool members are not registered users.', details } },
        { status: 400 },
      );
    }
    const dates = [...new Set(b.bookingDates ?? [])].sort();
    if (dates.length === 0) return fail(400, 'VALIDATION_ERROR', 'Select at least one date');
    if (dates.length > 20) return fail(400, 'VALIDATION_ERROR', 'Cannot book more than 20 dates at once');

    const results = dates.map((date) => {
      const day = availabilityState[date];
      const refuse = (code: string, message: string) => ({ bookingDate: date, outcome: 'FAILED' as const, code, message });
      if (day?.decided) {
        return refuse('WINDOW_CLOSED', `Allocation for ${date} has already run — this date is closed`);
      }
      if (day && day.myStatus !== null) return refuse('CONFLICT', 'You already have a PRIMARY booking for this date');
      if (day) {
        day.requestCount += 1;
        day.myStatus = 'SUBMITTED';
      }
      const id = nextId('bkg');
      const booking = {
        id,
        status: 'SUBMITTED' as const,
        bookingType: 'PRIMARY' as const,
        bookingDate: date,
        travelDistanceKm: 6.2,
        carpoolPeople: b.carpoolPeople ?? 1,
        submittedAt: new Date().toISOString(),
      };
      // Register a detail row so the outcome panel's "View status" link resolves in the demo.
      bookingState[id] = {
        ...booking,
        vehicleType: 'CAR',
        vehicleNumber: null,
        carpoolMemberCount: (b.carpoolPeople ?? 1) - 1,
        specialRequirement: null,
        allocationScore: null,
        allocatedSlotNumber: null,
        createdAt: booking.submittedAt,
        carpoolMembers: [],
      } as BookingDetail;
      return { bookingDate: date, outcome: 'CREATED' as const, booking };
    });

    const createdCount = results.filter((r) => r.outcome === 'CREATED').length;
    return ok({
      requested: results.length,
      createdCount,
      failedCount: results.length - createdCount,
      results,
    });
  }),
  http.get(`${baseURL}/bookings/:id`, ({ params }) => {
    const detail = bookingState[String(params.id)];
    if (!detail) return fail(404, 'NOT_FOUND', 'Booking not found');
    return ok<BookingDetail>(detail);
  }),
  http.post(`${baseURL}/bookings/:id/release`, ({ params }) => {
    const id = String(params.id);
    const detail = bookingState[id];
    if (!detail) return fail(404, 'NOT_FOUND', 'Booking not found');
    // Stateful: a subsequent GET reflects the release (demo fidelity, branch-2 L1).
    bookingState[id] = { ...detail, status: 'RELEASED', allocatedSlotNumber: null };
    return ok<BookingDetail>(bookingState[id]);
  }),
  http.patch(`${baseURL}/bookings/:id`, async ({ params, request }) => {
    const id = String(params.id);
    const detail = bookingState[id];
    if (!detail) return fail(404, 'NOT_FOUND', 'Booking not found');
    const body = (await request.json().catch(() => ({}))) as Partial<{
      vehicleType: BookingDetail['vehicleType']; vehicleNumber: string | null;
      carpoolPeople: number; specialRequirement: string | null;
    }>;
    if (body.vehicleType !== undefined) detail.vehicleType = body.vehicleType;
    if (body.vehicleNumber !== undefined) detail.vehicleNumber = body.vehicleNumber;
    if (body.specialRequirement !== undefined) detail.specialRequirement = body.specialRequirement;
    if (body.carpoolPeople != null) detail.carpoolMemberCount = Math.max(0, body.carpoolPeople - 1);
    bookingState[id] = detail;
    return ok<BookingDetail>(detail);
  }),
  http.get(`${baseURL}/me`, () => {
    return ok<UserProfile>(currentMockProfile());
  }),
  http.patch(`${baseURL}/me`, async ({ request }) => {
    const current = currentMockProfile();
    const body = await request.json() as Partial<UserProfile>;
    const updated = { ...current, ...body, updatedAt: new Date().toISOString() };
    profileState[current.id] = updated;
    const s = readMockSession();
    if (s && body.fullName) writeMockSession({ ...s, fullName: body.fullName });
    return ok<UserProfile>(updated);
  }),
  http.get(`${baseURL}/me/vehicles`, () => {
    const me = currentMockProfile();
    return ok<VehicleSummary[]>(vehicleState.filter((v) => v.ownerEmail === me.email));
  }),
  http.post(`${baseURL}/me/vehicles`, async ({ request }) => {
    const me = currentMockProfile();
    const body = await request.json() as Partial<VehicleSummary> & { vehicleNumber?: string };
    const plate = normalizeMockPlate(body.vehicleNumber ?? '');
    if (!plate) return fail(400, 'VALIDATION_ERROR', 'Car number is required');
    const existing = vehicleState.find((v) => v.vehicleNumber === plate);
    if (existing && existing.ownerEmail !== me.email) return fail(409, 'CONFLICT', 'This car number is already registered to another user');
    const vehicle: VehicleSummary = {
      id: existing?.id ?? nextId('veh'),
      vehicleNumber: plate,
      displayNumber: body.displayNumber || body.vehicleNumber || plate,
      ownerName: me.fullName,
      ownerEmail: me.email,
      contactNumber: me.contactNumber,
      vehicleType: body.vehicleType ?? 'CAR',
      makeModel: body.makeModel ?? null,
      colour: body.colour ?? null,
      companyId: me.companyId,
      companyName: me.companyName,
    };
    vehicleState = existing ? vehicleState.map((v) => (v.id === existing.id ? vehicle : v)) : [vehicle, ...vehicleState];
    return ok<VehicleSummary>(vehicle, 201);
  }),
  // Partial edit of one of the caller's own cars, including its number (P: profile car editing).
  http.patch(`${baseURL}/me/vehicles/:id`, async ({ params, request }) => {
    const me = currentMockProfile();
    const id = String(params.id);
    const current = vehicleState.find((v) => v.id === id && v.ownerEmail === me.email);
    if (!current) return fail(404, 'NOT_FOUND', 'Car not found');

    const body = (await request.json()) as Partial<VehicleSummary> & { vehicleNumber?: string };
    const plate = body.vehicleNumber !== undefined ? normalizeMockPlate(body.vehicleNumber) : current.vehicleNumber;
    if (!plate) return fail(400, 'VALIDATION_ERROR', 'Car number is required');
    // Same conflict rule as create: another owner's plate is never claimable.
    const clash = vehicleState.find((v) => v.vehicleNumber === plate && v.id !== id);
    if (clash && clash.ownerEmail !== me.email) {
      return fail(409, 'CONFLICT', 'This car number is already registered to another user');
    }

    const updated: VehicleSummary = {
      ...current,
      vehicleNumber: plate,
      displayNumber:
        body.displayNumber ?? (body.vehicleNumber !== undefined ? body.vehicleNumber : current.displayNumber),
      ...(body.vehicleType !== undefined ? { vehicleType: body.vehicleType } : {}),
      ...(body.makeModel !== undefined ? { makeModel: body.makeModel } : {}),
      ...(body.colour !== undefined ? { colour: body.colour } : {}),
    };
    vehicleState = vehicleState
      .filter((v) => !(clash && v.id === clash.id)) // merged into this row, as the server does
      .map((v) => (v.id === id ? updated : v));
    return ok<VehicleSummary>(updated);
  }),
  http.delete(`${baseURL}/me/vehicles/:id`, ({ params }) => {
    const me = currentMockProfile();
    const id = String(params.id);
    const vehicle = vehicleState.find((v) => v.id === id && v.ownerEmail === me.email);
    if (!vehicle) return fail(404, 'NOT_FOUND', 'Car not found');
    vehicleState = vehicleState.filter((v) => v.id !== id);
    return ok<{ id: string }>({ id });
  }),
  http.get(`${baseURL}/dashboard/user`, () =>
    ok<UserDashboard>({
      upcomingBooking: toSummary(bookingState['mock-booking-1']),
      cutoffCountdownSeconds: 3600,
      nextAllocationRunAt: mockWindow().nextRunAt,
      nextAllocationRunCountdownSeconds: mockWindow().nextRunCountdownSeconds,
      nextAllocationRuns: mockWindow().nextRuns,
      previousBookingsCount: 2,
    }),
  ),
  http.get(`${baseURL}/me/bookings`, ({ request }) => {
    const { page, pageSize } = pageParams(request);
    const all = HISTORY_IDS.map((id) => toSummary(bookingState[id]));
    const start = (page - 1) * pageSize;
    return okPage(all.slice(start, start + pageSize), page, pageSize, all.length);
  }),

  // Admin booking roster (CA/SA). Honours ?date, ?companyId, ?status filters + pagination.
  http.get(`${baseURL}/bookings`, ({ request }) => {
    const url = new URL(request.url);
    const date = url.searchParams.get('date');
    const companyId = url.searchParams.get('companyId');
    const status = url.searchParams.get('status');
    const { page, pageSize } = pageParams(request);
    let rows = seedAdminBookings();
    if (date) rows = rows.filter((r) => r.bookingDate === date);
    if (companyId) rows = rows.filter((r) => r.companyId === companyId);
    if (status) rows = rows.filter((r) => r.status === status);
    const start = (page - 1) * pageSize;
    return okPage(rows.slice(start, start + pageSize), page, pageSize, rows.length);
  }),

  // --- Allocation (super admin) ---
  // Existing-run lookup: null = not yet run for this date+type (tests needing a run override this).
  http.get(`${baseURL}/allocation/runs`, () => ok<AllocationRunSummary | null>(null)),
  http.post(`${baseURL}/allocation/primary/run`, () =>
    ok<AllocationRunSummary>({
      id: 'run-demo', runType: 'PRIMARY', bookingDate: '2026-08-03', status: 'COMPLETED',
      idempotencyKey: 'demo', attemptCount: 1, totalRequests: 3, allocatedCount: 2, waitlistedCount: 1,
    }),
  ),
  http.post(`${baseURL}/allocation/common-pool/run`, () =>
    ok<AllocationRunSummary>({
      id: 'run-cp-demo', runType: 'COMMON_POOL', bookingDate: '2026-08-03', status: 'COMPLETED',
      idempotencyKey: 'demo-cp', attemptCount: 1, totalRequests: 2, allocatedCount: 2, waitlistedCount: 0,
    }),
  ),
  http.get(`${baseURL}/allocation/runs/by-date`, () => ok<AllocationRunSummary | null>(null)),
  http.get(`${baseURL}/allocation/runs/:id/breakdown`, ({ params }) =>
    ok<AllocationBreakdown>({
      runId: String(params.id), bookingDate: '2026-08-03', status: 'COMPLETED',
      weights: { distanceWeight: 0.6, carpoolWeight: 0.4 },
      results: [
        { rank: 1, bookingId: 'b1', userId: 'u1', user: 'Priya Rao', companyName: 'Mock Co', distanceKm: 2.4, people: 3, distanceScore: 12, carpoolScore: 100, finalScore: 47.2, outcome: 'ALLOCATED', slotNumber: 'A-12' },
        { rank: 2, bookingId: 'b2', userId: 'u2', user: 'Sam Lee', companyName: 'Mock Co', distanceKm: 5.1, people: 2, distanceScore: 25.5, carpoolScore: 50, finalScore: 35.3, outcome: 'ALLOCATED', slotNumber: 'A-13' },
        { rank: 3, bookingId: 'b3', userId: 'u3', user: 'Lee Chen', companyName: 'Northwind', distanceKm: 8.7, people: 1, distanceScore: 43.5, carpoolScore: 0, finalScore: 26.1, outcome: 'WAITLISTED', slotNumber: null },
      ],
    }),
  ),
  http.get(`${baseURL}/allocations`, ({ request }) => {
    const url = new URL(request.url);
    const date = url.searchParams.get('date');
    const companyId = url.searchParams.get('companyId');
    const type = url.searchParams.get('type');
    const { page, pageSize } = pageParams(request);
    let rows = seedAllocations();
    if (date) rows = rows.filter((r) => r.bookingDate === date);
    if (companyId) rows = rows.filter((r) => r.companyId === companyId);
    if (type) rows = rows.filter((r) => r.allocationType === type);
    const start = (page - 1) * pageSize;
    return okPage(rows.slice(start, start + pageSize), page, pageSize, rows.length);
  }),

  // --- Config (super admin) ---
  http.get(`${baseURL}/config`, () => ok<ConfigEntry[]>(configState)),
  http.patch(`${baseURL}/config`, async ({ request }) => {
    const patch = (await request.json().catch(() => ({}))) as Record<string, string>;
    for (const entry of configState) {
      const next = patch[entry.key];
      if (next !== undefined) entry.value = next;
    }
    return ok<ConfigEntry[]>(configState);
  }),

  // --- Dashboards ---
  http.get(`${baseURL}/dashboard/super-admin`, () =>
    ok<SuperAdminDashboard>({
      totalParkingSlots: 120, totalActiveCompanies: 2, blockedSlots: 8, availableSlots: 34,
      primaryBookings: 62, commonPoolBookings: 16, waitlistCount: 9, dailyUtilizationPct: 71.5,
    }),
  ),
  http.get(`${baseURL}/dashboard/company-admin`, () =>
    ok<CompanyAdminDashboard>({
      totalCompanySlots: 20, availableCompanySlots: 5, blockedSlots: 3, bookedSlots: 12,
      commonPoolSlots: 2, totalBookingRequests: 18, allocatedUsers: 12, waitlistedUsers: 4,
      dailyUtilizationPct: 80,
    }),
  ),

  // --- Companies (super admin) ---
  http.get(`${baseURL}/companies`, ({ request }) => {
    const { page, pageSize } = pageParams(request);
    const start = (page - 1) * pageSize;
    return okPage(companyState.slice(start, start + pageSize), page, pageSize, companyState.length);
  }),
  http.get(`${baseURL}/companies/quota-summary`, ({ request }) => {
    const date = new URL(request.url).searchParams.get('date') || '9999-12-31';
    const entries: CompanyQuotaSummaryEntry[] = companyState.map((c) => {
      const eff = (quotaState[c.id] ?? [])
        .filter((q) => q.effectiveFrom <= date && (!q.effectiveTo || q.effectiveTo >= date))
        .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
      return { companyId: c.id, assignedSlots: eff?.slotCount ?? 0 };
    });
    return ok<CompanyQuotaSummaryEntry[]>(entries);
  }),
  http.post(`${baseURL}/companies`, async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { name?: string; code?: string };
    if (!body.name || !body.code) return fail(400, 'VALIDATION_ERROR', 'name and code are required');
    if (companyState.some((c) => c.code === body.code)) return fail(409, 'CONFLICT', 'Company code already exists');
    const now = '2026-07-29T00:00:00.000Z';
    const company: Company = { id: nextId('co'), name: body.name, code: body.code, status: 'ACTIVE', createdAt: now, updatedAt: now };
    companyState = [...companyState, company];
    return ok<Company>(company, 201);
  }),
  http.patch(`${baseURL}/companies/:id/status`, async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { status?: Company['status'] };
    const company = companyState.find((c) => c.id === String(params.id));
    if (!company) return fail(404, 'NOT_FOUND', 'Company not found');
    if (body.status) company.status = body.status;
    return ok<Company>(company);
  }),

  // --- Company users + approvals ---
  // Super Admin's pending company-admin request queue (F11): PENDING + COMPANY_ADMIN, any company.
  http.get(`${baseURL}/users/pending-admins`, ({ request }) => {
    const { page, pageSize } = pageParams(request);
    const all = Object.values(companyUserState)
      .flat()
      .filter((u) => u.status === 'PENDING' && (u.role === 'COMPANY_ADMIN' || u.role === 'SECURITY'));
    const start = (page - 1) * pageSize;
    return okPage(all.slice(start, start + pageSize), page, pageSize, all.length);
  }),
  http.get(`${baseURL}/users/admin-requests/history`, ({ request }) => {
    const { page, pageSize } = pageParams(request);
    // Processed company-admin requests (approval history): decided ACTIVE/REJECTED admins,
    // newest decision first (backend sorts by updatedAt desc) — sort before paginating.
    const all = Object.values(companyUserState)
      .flat()
      .filter((u) => (u.role === 'COMPANY_ADMIN' || u.role === 'SECURITY') && (u.status === 'ACTIVE' || u.status === 'REJECTED'))
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    const start = (page - 1) * pageSize;
    return okPage(all.slice(start, start + pageSize), page, pageSize, all.length);
  }),
  http.get(`${baseURL}/companies/:id/users`, ({ params, request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const { page, pageSize } = pageParams(request);
    let users = companyUserState[String(params.id)] ?? [];
    if (status) users = users.filter((u) => u.status === status);
    const start = (page - 1) * pageSize;
    return okPage(users.slice(start, start + pageSize), page, pageSize, users.length);
  }),
  http.patch(`${baseURL}/users/:id/approval`, async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as { decision?: unknown };
    // `decision` is required by the contract — reject anything but APPROVE/REJECT (don't
    // silently treat a missing/invalid value as a rejection).
    if (body.decision !== 'APPROVE' && body.decision !== 'REJECT') {
      return fail(400, 'VALIDATION_ERROR', 'decision must be APPROVE or REJECT');
    }
    const id = String(params.id);
    let updated: UserProfile | undefined;
    for (const list of Object.values(companyUserState)) {
      const u = list.find((x) => x.id === id);
      if (u) {
        u.status = body.decision === 'APPROVE' ? 'ACTIVE' : 'REJECTED';
        updated = u;
        break;
      }
    }
    if (!updated) return fail(404, 'NOT_FOUND', 'User not found');
    return ok<UserProfile>(updated);
  }),
  http.delete(`${baseURL}/users/:id`, ({ params }) => {
    const id = String(params.id);
    let removed = false;
    for (const [companyId, list] of Object.entries(companyUserState)) {
      const next = list.filter((u) => u.id !== id);
      if (next.length !== list.length) {
        companyUserState[companyId] = next;
        removed = true;
      }
    }
    if (!removed) return fail(404, 'NOT_FOUND', 'User not found');
    return ok<{ message: string }>({ message: 'User removed' });
  }),

  // --- Slots (super admin) ---
  http.get(`${baseURL}/slots`, ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const { page, pageSize } = pageParams(request);
    let slots = slotState;
    if (status) slots = slots.filter((s) => s.status === status);
    const start = (page - 1) * pageSize;
    return okPage(slots.slice(start, start + pageSize), page, pageSize, slots.length);
  }),
  http.get(`${baseURL}/parking-areas`, () => ok<ParkingArea[]>(parkingAreaState)),
  http.post(`${baseURL}/parking-areas`, async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { name?: string; floor?: string | null };
    if (!body.name?.trim()) return fail(400, 'VALIDATION_ERROR', 'name is required');
    // Backend `createParkingAreaSchema` allows floor to be null or a non-empty string only.
    if (typeof body.floor === 'string' && body.floor.trim() === '') {
      return fail(400, 'VALIDATION_ERROR', 'floor must be null or a non-empty string');
    }
    const area: ParkingArea = {
      id: nextId('area'), name: body.name.trim(), floor: body.floor ?? null, officeLocationId: 'office-1',
    };
    parkingAreaState = [...parkingAreaState, area];
    return ok<ParkingArea>(area, 201);
  }),
  http.post(`${baseURL}/slots`, async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Partial<ParkingSlot> & { slotNumber?: string; parkingAreaId?: string };
    if (!body.slotNumber || !body.parkingAreaId) return fail(400, 'VALIDATION_ERROR', 'slotNumber and parkingAreaId are required');
    if (slotState.some((s) => s.slotNumber === body.slotNumber)) return fail(409, 'CONFLICT', 'Slot number already exists');
    const now = '2026-07-29T00:00:00.000Z';
    const slot: ParkingSlot = {
      id: nextId('slot'), slotNumber: body.slotNumber, parkingAreaId: body.parkingAreaId,
      slotType: body.slotType ?? 'STANDARD', status: 'AVAILABLE',
      hasEvCharging: Boolean(body.hasEvCharging), isAccessible: Boolean(body.isAccessible),
      createdAt: now, updatedAt: now,
    };
    slotState = [...slotState, slot];
    return ok<ParkingSlot>(slot, 201);
  }),
  http.patch(`${baseURL}/slots/:id`, async ({ params, request }) => {
    const id = String(params.id);
    const body = (await request.json().catch(() => ({}))) as Partial<ParkingSlot>;
    const slot = slotState.find((s) => s.id === id);
    if (!slot) return fail(404, 'NOT_FOUND', 'Slot not found');
    Object.assign(slot, body);
    return ok<ParkingSlot>(slot);
  }),
  http.delete(`${baseURL}/slots/:id`, ({ params }) => {
    const id = String(params.id);
    const before = slotState.length;
    slotState = slotState.filter((s) => s.id !== id);
    if (slotState.length === before) return fail(404, 'NOT_FOUND', 'Slot not found');
    return ok({ message: 'Slot removed' });
  }),

  // --- Quota (super admin) ---
  http.get(`${baseURL}/companies/:id/quota`, ({ params }) => ok<CompanyQuota[]>(quotaState[String(params.id)] ?? [])),
  http.post(`${baseURL}/companies/:id/quota`, async ({ params, request }) => {
    const companyId = String(params.id);
    const body = (await request.json().catch(() => ({}))) as { slotCount?: number; effectiveFrom?: string; effectiveTo?: string | null };
    if (body.slotCount == null || !body.effectiveFrom) return fail(400, 'VALIDATION_ERROR', 'slotCount and effectiveFrom are required');
    const row: CompanyQuota = {
      id: nextId('q'), companyId, slotCount: body.slotCount, effectiveFrom: body.effectiveFrom,
      effectiveTo: body.effectiveTo ?? null, createdAt: '2026-07-29T00:00:00.000Z',
    };
    quotaState[companyId] = [...(quotaState[companyId] ?? []), row];
    return ok<CompanyQuota>(row, 201);
  }),

  // --- Blocks ---
  http.get(`${baseURL}/companies/:id/blocks`, ({ params, request }) => {
    const { page, pageSize } = pageParams(request);
    const blocks = blockState[String(params.id)] ?? [];
    const start = (page - 1) * pageSize;
    return okPage(blocks.slice(start, start + pageSize), page, pageSize, blocks.length);
  }),
  http.post(`${baseURL}/companies/:id/blocks`, async ({ params, request }) => {
    const companyId = String(params.id);
    const body = (await request.json().catch(() => ({}))) as Partial<SlotBlock>;
    if (body.blockedCount == null || !body.startDate || !body.endDate || !body.reason) {
      return fail(400, 'VALIDATION_ERROR', 'blockedCount, startDate, endDate and reason are required');
    }
    const block: SlotBlock = {
      id: nextId('blk'), companyId, blockedCount: body.blockedCount, startDate: body.startDate,
      endDate: body.endDate, reason: body.reason, reasonText: body.reasonText ?? null,
      createdAt: '2026-07-29T00:00:00.000Z',
    };
    blockState[companyId] = [...(blockState[companyId] ?? []), block];
    return ok<SlotBlock>(block, 201);
  }),
  // --- Availability / slot grid (Phase 7) ---
  http.get(`${baseURL}/availability`, ({ request }) => {
    const url = new URL(request.url);
    const win = mockWindow();
    const from = url.searchParams.get('from') ?? win.earliestDate;
    const to = url.searchParams.get('to') ?? win.latestDate;
    // Dev/test-only query-param toggle (P8-10): force these dates to render DECIDED for this response,
    // without mutating the shared mock store — a lighter-weight alternative to `setMockDatePhase`.
    const forceDecided = new Set((url.searchParams.get('mockDecide') ?? '').split(',').filter(Boolean));
    const days: DayAvailability[] = [];
    for (let d = new Date(`${from}T00:00:00`); isoOf(d) <= to; d = addDaysTo(d, 1)) {
      const date = isoOf(d);
      if (!isWeekday(date)) {
        days.push({
          date, phase: 'OPEN', quota: MOCK_QUOTA, blocked: 0, requestCount: 0, allocatedCount: 0,
          available: 0, mine: false, myStatus: null, mySlotNumber: null,
          requestable: false, reason: 'NOT_WEEKDAY',
          message: 'Booking date must be a bookable weekday (Mon–Fri)',
          boxes: [],
        });
        continue;
      }
      const st: MockDayState = availabilityState[date] ?? {
        requestCount: 0, blocked: 0, decided: false, myStatus: null, mySlotNumber: null, otherSlots: [],
      };
      const phase: DayAvailability['phase'] = st.decided || forceDecided.has(date) ? 'DECIDED' : 'OPEN';
      const allocatedCount = phase === 'DECIDED' ? st.otherSlots.length + (st.myStatus === 'ALLOCATED' ? 1 : 0) : 0;
      const available =
        phase === 'DECIDED' ? Math.max(0, MOCK_QUOTA - st.blocked - allocatedCount) : Math.max(0, MOCK_QUOTA - st.blocked);
      const inWindow = date >= win.earliestDate && date <= win.latestDate;
      const mine = st.myStatus !== null;
      const reason: DayAvailability['reason'] =
        !inWindow ? (date < win.earliestDate ? 'TOO_SOON' : 'BEYOND_WINDOW')
        : mine ? 'ALREADY_BOOKED'
        : phase === 'DECIDED' ? 'TOO_SOON'
        : null;
      const message =
        reason === 'TOO_SOON' ? `${date} has already been allocated.`
        : reason === 'BEYOND_WINDOW' ? `${date} is beyond the ${WINDOW_WEEKS}-week booking window.`
        : reason === 'ALREADY_BOOKED' ? 'You already have a request for this date.'
        : null;
      const boxes =
        phase === 'OPEN'
          ? buildOpenBoxes(MOCK_QUOTA, st.blocked)
          : buildDecidedBoxes(MOCK_QUOTA, st.blocked, st.otherSlots, st.myStatus === 'ALLOCATED' ? st.mySlotNumber : null);
      days.push({
        date, phase, quota: MOCK_QUOTA, blocked: st.blocked, requestCount: st.requestCount, allocatedCount,
        available, mine, myStatus: st.myStatus, mySlotNumber: st.mySlotNumber,
        requestable: reason === null, reason, message, boxes,
      });
    }
    return ok<AvailabilityResponse>({ window: win, days });
  }),

  // --- Weekly allocation batch (Phase 7) ---
  http.get(`${baseURL}/allocation/weekly`, () => {
    const win = mockWindow();
    const band = mockBand(win);
    return ok<WeeklyRunPreview>({
      window: win,
      band,
      dates: band.dates.map((date) => {
        const st = availabilityState[date];
        return {
          bookingDate: date,
          runStatus: st?.decided ? 'COMPLETED' : null,
          pendingRequests: st?.requestCount ?? 0,
          commonPoolStatus: st?.pooled ? ('COMPLETED' as const) : null,
          waitlistedRequests: mockDayCounts(st).waitlisted,
        };
      }),
    });
  }),
  http.post(`${baseURL}/allocation/weekly/run`, () => {
    const win = mockWindow();
    const band = mockBand(win);
    const results = band.dates.map((date) => {
      const st = availabilityState[date];
      const alreadyDecided = st?.decided ?? false;
      const capacity = st ? MOCK_QUOTA - st.blocked : MOCK_QUOTA;
      if (st && !alreadyDecided) {
        // Score-decided allocation (D18/D22): fill up to capacity, the caller's own SUBMITTED request
        // included in the ranking like anyone else's — this mock just approximates "earlier = better".
        const iAmSubmitted = st.myStatus === 'SUBMITTED';
        const otherRequestCount = Math.max(0, st.requestCount - (iAmSubmitted ? 1 : 0));
        const otherAllocated = Math.min(otherRequestCount, capacity - (iAmSubmitted ? 1 : 0));
        st.otherSlots = Array.from({ length: Math.max(0, otherAllocated) }, (_v, i) => slotLabel(i + 1));
        if (iAmSubmitted) {
          const gotSlot = st.requestCount <= capacity;
          st.myStatus = gotSlot ? 'ALLOCATED' : 'WAITLISTED';
          st.mySlotNumber = gotSlot ? slotLabel(st.otherSlots.length + 1) : null;
        }
        st.decided = true;
      }
      const allocated = st ? st.otherSlots.length + (st.myStatus === 'ALLOCATED' ? 1 : 0) : 0;
      return {
        bookingDate: date,
        runId: `mock-run-${date}`,
        status: 'COMPLETED' as const,
        alreadyDecided,
        allocated,
        waitlisted: st ? Math.max(0, st.requestCount - allocated) : 0,
        error: null,
      };
    });
    return ok<WeeklyRunResult>({
      runAt: new Date().toISOString(),
      band,
      dates: results,
      totalAllocated: results.reduce((sum, r) => sum + r.allocated, 0),
      totalWaitlisted: results.reduce((sum, r) => sum + r.waitlisted, 0),
    });
  }),

  // Band-scoped common pool: hands each date's leftover capacity to whoever primary waitlisted.
  // Idempotent per date via `pooled`, mirroring the server's (COMMON_POOL, date) uniqueness.
  http.post(`${baseURL}/allocation/weekly/common-pool/run`, () => {
    const win = mockWindow();
    const band = mockBand(win);
    const results = band.dates.map((date) => {
      const st = availabilityState[date];
      const alreadyDecided = st?.pooled ?? false;
      const { allocated: primaryAllocated, waitlisted } = mockDayCounts(st);
      if (!st || alreadyDecided || waitlisted === 0) {
        return {
          bookingDate: date,
          runId: `mock-cp-${date}`,
          status: 'COMPLETED' as const,
          alreadyDecided,
          allocated: 0,
          waitlisted,
          error: null,
        };
      }
      const spare = Math.max(0, MOCK_QUOTA - st.blocked - primaryAllocated);
      const placed = Math.min(waitlisted, spare);
      // Give the caller the first pooled slot when they were the one waitlisted — that is what makes
      // the change visible on their dashboard, which is the point of running this from the UI.
      if (st.myStatus === 'WAITLISTED' && placed > 0) {
        st.myStatus = 'ALLOCATED';
        st.mySlotNumber = slotLabel(primaryAllocated + 1);
        for (let i = 1; i < placed; i++) st.otherSlots.push(slotLabel(primaryAllocated + 1 + i));
      } else {
        for (let i = 0; i < placed; i++) st.otherSlots.push(slotLabel(primaryAllocated + 1 + i));
      }
      st.pooled = true;
      return {
        bookingDate: date,
        runId: `mock-cp-${date}`,
        status: 'COMPLETED' as const,
        alreadyDecided,
        allocated: placed,
        waitlisted: waitlisted - placed,
        error: null,
      };
    });
    return ok<WeeklyRunResult>({
      runAt: new Date().toISOString(),
      band,
      dates: results,
      totalAllocated: results.reduce((sum, r) => sum + r.allocated, 0),
      totalWaitlisted: results.reduce((sum, r) => sum + r.waitlisted, 0),
    });
  }),

  // --- Gate: vehicle registry + check-in/out (Phase 7) ---
  http.get(`${baseURL}/vehicles`, ({ request }) => {
    const term = normalizeMockPlate(new URL(request.url).searchParams.get('search') ?? '');
    if (!term) return ok<VehicleSummary[]>([]);
    return ok<VehicleSummary[]>(
      vehicleState.filter((v) => v.vehicleNumber.includes(term) || v.ownerName.toUpperCase().includes(term)),
    );
  }),
  http.get(`${baseURL}/vehicles/lookup`, ({ request }) => {
    const plate = normalizeMockPlate(new URL(request.url).searchParams.get('number') ?? '');
    if (plate.length < 4) return fail(400, 'VALIDATION_ERROR', 'Enter a car number');
    const vehicle = vehicleState.find((v) => v.vehicleNumber === plate) ?? null;
    const open = gateEventState.find((e) => e.vehicleNumber === plate && e.status === 'CHECKED_IN') ?? null;
    const hasBooking = bookedTodayPlates.has(plate);
    return ok<GateLookup>({
      vehicleNumber: plate,
      known: vehicle !== null,
      vehicle,
      bookingDate: isoOf(new Date()),
      hasBooking,
      // The booker's identity is populated whether or not the plate is in the registry — that is what
      // lets the console name an unregistered-but-booked driver.
      booking: hasBooking
        ? {
            id: 'mock-booking-1',
            status: 'ALLOCATED',
            bookingType: 'PRIMARY',
            allocatedSlotNumber: 'B1-03',
            employeeName: vehicle?.ownerName ?? 'Priya Rao',
            contactNumber: vehicle?.contactNumber ?? '9000000004',
            companyId: vehicle?.companyId ?? 'mock-co',
            companyName: vehicle?.companyName ?? 'Mock Co',
            userId: 'mock-user-1',
          }
        : null,
      openVisit: open ? { id: open.id, checkInAt: open.checkInAt } : null,
    });
  }),
  http.post(`${baseURL}/gate/check-in`, async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { vehicleNumber?: string; notes?: string | null };
    const plate = normalizeMockPlate(body.vehicleNumber ?? '');
    if (plate.length < 4) return fail(400, 'VALIDATION_ERROR', 'Enter a car number');
    if (gateEventState.some((e) => e.vehicleNumber === plate && e.status === 'CHECKED_IN')) {
      return fail(409, 'CONFLICT', `${plate} is already checked in — check it out first`);
    }
    // D16: an unknown plate is recorded, not refused.
    const vehicle = vehicleState.find((v) => v.vehicleNumber === plate) ?? null;
    const event: GateEvent = {
      id: nextId('gate'),
      vehicleNumber: plate,
      displayNumber: vehicle?.displayNumber ?? plate,
      ownerName: vehicle?.ownerName ?? null,
      companyId: vehicle?.companyId ?? null,
      companyName: vehicle?.companyName ?? null,
      bookingDate: isoOf(new Date()),
      bookingRequestId: bookedTodayPlates.has(plate) ? 'mock-booking-1' : null,
      hadBooking: bookedTodayPlates.has(plate),
      status: 'CHECKED_IN',
      checkInAt: new Date().toISOString(),
      checkOutAt: null,
      notes: body.notes ?? null,
    };
    gateEventState = [event, ...gateEventState];
    return ok<GateEvent>(event, 201);
  }),
  http.post(`${baseURL}/gate/check-out`, async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { vehicleNumber?: string };
    const plate = normalizeMockPlate(body.vehicleNumber ?? '');
    const open = gateEventState.find((e) => e.vehicleNumber === plate && e.status === 'CHECKED_IN');
    if (!open) return fail(404, 'NOT_FOUND', `${plate} is not currently checked in`);
    open.status = 'CHECKED_OUT';
    open.checkOutAt = new Date().toISOString();
    return ok<GateEvent>(open);
  }),
  http.get(`${baseURL}/gate/events`, ({ request }) => {
    const { page, pageSize } = pageParams(request);
    return okPage<GateEvent>(gateEventState, page, pageSize);
  }),
  http.get(`${baseURL}/gate/unbooked`, ({ request }) => {
    const { page, pageSize } = pageParams(request);
    return okPage<GateEvent>(gateEventState.filter((e) => !e.hadBooking), page, pageSize);
  }),
  http.delete(`${baseURL}/blocks/:id`, ({ params }) => {
    const id = String(params.id);
    for (const companyId of Object.keys(blockState)) {
      const before = blockState[companyId].length;
      blockState[companyId] = blockState[companyId].filter((b) => b.id !== id);
      if (blockState[companyId].length !== before) return ok({ message: 'Block removed' });
    }
    return fail(404, 'NOT_FOUND', 'Block not found');
  }),
];

// MSW matches in order — hero first, generated random handlers as fallback for the rest.
export const handlers = [...hero, ...generated];
