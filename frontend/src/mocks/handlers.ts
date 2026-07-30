import { HttpResponse, http } from 'msw';
import { handlers as generated } from './handlers.generated';
import type { components } from '../api/types';

type LoginResponseData = components['schemas']['LoginResponseData'];
type BookingCreatedData = components['schemas']['BookingCreatedData'];
type BookingDetail = components['schemas']['BookingDetail'];
type Booking = components['schemas']['Booking'];
type AllocationRunSummary = components['schemas']['AllocationRunSummary'];
type AllocationBreakdown = components['schemas']['AllocationBreakdown'];
type ConfigEntry = components['schemas']['ConfigEntry'];
type RoleName = components['schemas']['RoleName'];
type UserProfile = components['schemas']['UserProfile'];
type UserDashboard = components['schemas']['UserDashboard'];
type SuperAdminDashboard = components['schemas']['SuperAdminDashboard'];
type CompanyAdminDashboard = components['schemas']['CompanyAdminDashboard'];
type Company = components['schemas']['Company'];
type ParkingSlot = components['schemas']['ParkingSlot'];
type CompanyQuota = components['schemas']['CompanyQuota'];
type SlotBlock = components['schemas']['SlotBlock'];
type CompanySummary = components['schemas']['CompanySummary'];
type RegisterRequest = components['schemas']['RegisterRequest'];

const baseURL = '/api/v1';
const ok = <T,>(data: T, status = 200) => HttpResponse.json({ success: true, data }, { status });
const okPage = <T,>(items: T[], page: number, pageSize: number, total = items.length) =>
  HttpResponse.json({ success: true, data: items, meta: { page, pageSize, total } });
const fail = (status: number, code: string, message: string) =>
  HttpResponse.json({ success: false, error: { code, message } }, { status });

function roleForEmail(email: string): RoleName {
  if (email.startsWith('admin@')) return 'SUPER_ADMIN';
  if (email.startsWith('company@')) return 'COMPANY_ADMIN';
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
      id: 'mock-booking-1', bookingDate: '2026-08-03', bookingType: 'PRIMARY', status: 'ALLOCATED',
      travelDistanceKm: 8.5, vehicleType: 'CAR', vehicleNumber: 'KA-01-1234', carpoolMemberCount: 2,
      specialRequirement: null, allocationScore: 47.2, allocatedSlotNumber: 'A-12',
      submittedAt: '2026-07-29T09:00:00.000Z', createdAt: '2026-07-29T08:00:00.000Z',
      carpoolMembers: [{ id: 'm1', name: 'Sam Lee', employeeEmail: 'sam@acme.test', sameCompany: true, isScored: true }],
      scoreBreakdown: breakdownFor(8.5, 2, 38.8),
    },
    'bk-1': {
      id: 'bk-1', bookingDate: '2026-08-03', bookingType: 'PRIMARY', status: 'ALLOCATED',
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
  };
}

/** History list order (newest first). */
const HISTORY_IDS = ['bk-1', 'bk-2', 'bk-3'] as const;

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
  return {
    'mock-co': [
      userProfile('u-priya', 'Priya Rao', 'priya@mock.test', 'ACTIVE'),
      userProfile('u-sam', 'Sam Lee', 'sam@mock.test', 'ACTIVE'),
      userProfile('u-nadia', 'Nadia Khan', 'nadia@mock.test', 'PENDING'),
      userProfile('u-omar', 'Omar Diaz', 'omar@mock.test', 'PENDING'),
      userProfile('u-tess', 'Tess Vaughn', 'tess@mock.test', 'REJECTED'),
    ],
    // A pending company-admin registration (F11) — surfaces in the Super Admin's admin-request queue.
    'co-acme': [
      userProfile('u-blair', 'Blair Ng', 'blair@acme.test', 'PENDING', 'COMPANY_ADMIN', { id: 'co-acme', name: 'Acme Corp' }),
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

// --- Mutable demo state (reset via resetMockData) ---
let configState = seedConfig();
let bookingState = seedBookings();
let companyState = seedCompanies();
let companyUserState = seedCompanyUsers();
let slotState = seedSlots();
let quotaState = seedQuota();
let blockState = seedBlocks();
let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

/** Restore all mutable mock state to its seed. Call between tests (see test/setup.ts). */
export function resetMockData(): void {
  configState = seedConfig();
  bookingState = seedBookings();
  companyState = seedCompanies();
  companyUserState = seedCompanyUsers();
  slotState = seedSlots();
  quotaState = seedQuota();
  blockState = seedBlocks();
  seq = 0;
}

const pageParams = (request: Request) => {
  const url = new URL(request.url);
  return { page: Number(url.searchParams.get('page') ?? '1'), pageSize: Number(url.searchParams.get('pageSize') ?? '10') };
};

/** Coherent, deterministic handlers for the hero + admin flows (override the generated random ones). */
const hero = [
  // --- Auth ---
  http.post(`${baseURL}/auth/login`, async ({ request }) => {
    const body = (await request.json().catch(() => null)) as { email?: string; password?: string } | null;
    if (!body?.email || !body?.password) return fail(401, 'UNAUTHENTICATED', 'Invalid credentials');
    const role = roleForEmail(body.email);
    return ok<LoginResponseData>({
      accessToken: 'mock-access-token',
      tokenType: 'Bearer',
      expiresIn: 900,
      user: {
        id: `mock-${role.toLowerCase()}`,
        fullName: `Mock ${role.replace('_', ' ')}`,
        role,
        companyId: 'mock-co',
        companyName: 'Mock Co',
      },
    });
  }),
  http.post(`${baseURL}/auth/logout`, () => ok({ message: 'Signed out' })),
  http.get(`${baseURL}/companies/active`, () =>
    ok<CompanySummary[]>(companyState.filter((c) => c.status === 'ACTIVE').map((c) => ({ id: c.id, name: c.name }))),
  ),
  http.post(`${baseURL}/auth/register`, async ({ request }) => {
    const b = (await request.json().catch(() => ({}))) as Partial<RegisterRequest>;
    if (!b.fullName || !b.companyId || !b.email || !b.password) {
      return fail(400, 'VALIDATION_ERROR', 'Missing required fields');
    }
    if (b.password !== b.confirmPassword) return fail(400, 'VALIDATION_ERROR', 'Passwords do not match');
    const exists = Object.values(companyUserState).some((list) => list.some((u) => u.email === b.email));
    if (exists) return fail(409, 'CONFLICT', 'An account with this email already exists');
    const company = companyState.find((c) => c.id === b.companyId && c.status === 'ACTIVE');
    if (!company) return fail(400, 'VALIDATION_ERROR', 'Company must be active');
    // Create as PENDING and add to the company's user list. A COMPANY_ADMIN request (F11) gets the
    // COMPANY_ADMIN role so it surfaces in the Super Admin's admin-request queue instead.
    const role: RoleName = b.registrationType === 'COMPANY_ADMIN' ? 'COMPANY_ADMIN' : 'USER';
    const user: UserProfile = {
      ...userProfile(nextId('u'), b.fullName, b.email, 'PENDING', role, { id: company.id, name: company.name }),
      contactNumber: b.contactNumber ?? '—', address: b.address ?? '—', pinCode: b.pinCode ?? '—',
      distanceKm: b.distanceKm ?? null,
    };
    companyUserState[company.id] = [...(companyUserState[company.id] ?? []), user];
    return ok<UserProfile>(user, 201);
  }),

  // --- User bookings ---
  http.post(`${baseURL}/bookings`, async ({ request }) => {
    const b = (await request.json().catch(() => ({}))) as { bookingDate?: string; carpoolPeople?: number };
    return ok<BookingCreatedData>(
      {
        id: 'mock-booking-1',
        status: 'SUBMITTED',
        bookingType: 'PRIMARY',
        bookingDate: b.bookingDate ?? '2026-08-03',
        travelDistanceKm: 6.2,
        carpoolPeople: b.carpoolPeople ?? 1,
        submittedAt: '2026-07-29T09:00:00.000Z',
      },
      201,
    );
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
  http.get(`${baseURL}/me`, () =>
    ok<UserProfile>(userProfile('mock-user', 'Mock User', 'user@acme.test', 'ACTIVE')),
  ),
  http.get(`${baseURL}/dashboard/user`, () =>
    ok<UserDashboard>({
      upcomingBooking: toSummary(bookingState['mock-booking-1']),
      cutoffCountdownSeconds: 3600,
      previousBookingsCount: 2,
    }),
  ),
  http.get(`${baseURL}/me/bookings`, ({ request }) => {
    const { page, pageSize } = pageParams(request);
    const all = HISTORY_IDS.map((id) => toSummary(bookingState[id]));
    const start = (page - 1) * pageSize;
    return okPage(all.slice(start, start + pageSize), page, pageSize, all.length);
  }),

  // --- Allocation (super admin) ---
  http.post(`${baseURL}/allocation/primary/run`, () =>
    ok<AllocationRunSummary>({
      id: 'run-demo', runType: 'PRIMARY', bookingDate: '2026-08-03', status: 'COMPLETED',
      idempotencyKey: 'demo', attemptCount: 1, totalRequests: 3, allocatedCount: 2, waitlistedCount: 1,
    }),
  ),
  http.get(`${baseURL}/allocation/runs/:id/breakdown`, ({ params }) =>
    ok<AllocationBreakdown>({
      runId: String(params.id), bookingDate: '2026-08-03', status: 'COMPLETED',
      weights: { distanceWeight: 0.6, carpoolWeight: 0.4 },
      results: [
        { rank: 1, bookingId: 'b1', userId: 'u1', user: 'Priya Rao', distanceKm: 2.4, people: 3, distanceScore: 12, carpoolScore: 100, finalScore: 47.2, outcome: 'ALLOCATED', slotNumber: 'A-12' },
        { rank: 2, bookingId: 'b2', userId: 'u2', user: 'Sam Lee', distanceKm: 5.1, people: 2, distanceScore: 25.5, carpoolScore: 50, finalScore: 35.3, outcome: 'ALLOCATED', slotNumber: 'A-13' },
        { rank: 3, bookingId: 'b3', userId: 'u3', user: 'Lee Chen', distanceKm: 8.7, people: 1, distanceScore: 43.5, carpoolScore: 0, finalScore: 26.1, outcome: 'WAITLISTED', slotNumber: null },
      ],
    }),
  ),

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
      .filter((u) => u.status === 'PENDING' && u.role === 'COMPANY_ADMIN');
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
