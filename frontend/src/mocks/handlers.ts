import { HttpResponse, http } from 'msw';
import { handlers as generated } from './handlers.generated';
import type { components } from '../api/types';

type LoginResponseData = components['schemas']['LoginResponseData'];
type BookingCreatedData = components['schemas']['BookingCreatedData'];
type BookingDetail = components['schemas']['BookingDetail'];
type AllocationRunSummary = components['schemas']['AllocationRunSummary'];
type AllocationBreakdown = components['schemas']['AllocationBreakdown'];
type ConfigEntry = components['schemas']['ConfigEntry'];
type RoleName = components['schemas']['RoleName'];
type UserProfile = components['schemas']['UserProfile'];
type UserDashboard = components['schemas']['UserDashboard'];
type Booking = components['schemas']['Booking'];

const baseURL = '/api/v1';
const ok = <T,>(data: T, status = 200) => HttpResponse.json({ success: true, data }, { status });
const fail = (status: number, code: string, message: string) =>
  HttpResponse.json({ success: false, error: { code, message } }, { status });

function roleForEmail(email: string): RoleName {
  if (email.startsWith('admin@')) return 'SUPER_ADMIN';
  if (email.startsWith('company@')) return 'COMPANY_ADMIN';
  return 'USER';
}

const configSeed: ConfigEntry[] = [
  { key: 'primary.window.open', value: '18:00', valueType: 'TIME' },
  { key: 'primary.window.cutoff', value: '21:00', valueType: 'TIME' },
  { key: 'scoring.distanceWeight', value: '0.6', valueType: 'NUMBER' },
  { key: 'scoring.carpoolWeight', value: '0.4', valueType: 'NUMBER' },
  { key: 'carpool.maxPeople', value: '4', valueType: 'NUMBER' },
];

/** Coherent, deterministic handlers for the hero flow (override the generated random ones). */
const hero = [
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
  http.get(`${baseURL}/bookings/:id`, ({ params }) =>
    ok<BookingDetail>({
      id: String(params.id),
      bookingDate: '2026-08-03',
      bookingType: 'PRIMARY',
      status: 'ALLOCATED',
      travelDistanceKm: 8.5,
      vehicleType: 'CAR',
      vehicleNumber: 'KA-01-1234',
      carpoolMemberCount: 2,
      specialRequirement: null,
      allocationScore: 47.2,
      allocatedSlotNumber: 'A-12',
      submittedAt: '2026-07-29T09:00:00.000Z',
      createdAt: '2026-07-29T08:00:00.000Z',
      carpoolMembers: [
        { id: 'm1', name: 'Sam Lee', employeeEmail: 'sam@acme.test', sameCompany: true, isScored: true },
      ],
      scoreBreakdown: {
        distanceKm: 8.5, people: 2, distanceScore: 42.5, carpoolScore: 33.3,
        distanceWeight: 0.6, carpoolWeight: 0.4, finalScore: 38.8,
      },
    }),
  ),
  http.post(`${baseURL}/bookings/:id/release`, ({ params }) =>
    ok<BookingDetail>({
      id: String(params.id),
      bookingDate: '2026-08-03',
      bookingType: 'PRIMARY',
      status: 'RELEASED',
      travelDistanceKm: 8.5,
      vehicleType: 'CAR',
      vehicleNumber: 'KA-01-1234',
      carpoolMemberCount: 2,
      specialRequirement: null,
      allocationScore: 47.2,
      allocatedSlotNumber: null,
      submittedAt: '2026-07-29T09:00:00.000Z',
      createdAt: '2026-07-29T08:00:00.000Z',
      carpoolMembers: [],
    }),
  ),
  http.post(`${baseURL}/allocation/primary/run`, () =>
    ok<AllocationRunSummary>({
      id: 'run-demo',
      runType: 'PRIMARY',
      bookingDate: '2026-08-03',
      status: 'COMPLETED',
      idempotencyKey: 'demo',
      attemptCount: 1,
      totalRequests: 3,
      allocatedCount: 2,
      waitlistedCount: 1,
    }),
  ),
  http.get(`${baseURL}/allocation/runs/:id/breakdown`, ({ params }) =>
    ok<AllocationBreakdown>({
      runId: String(params.id),
      bookingDate: '2026-08-03',
      status: 'COMPLETED',
      weights: { distanceWeight: 0.6, carpoolWeight: 0.4 },
      results: [
        { rank: 1, bookingId: 'b1', userId: 'u1', user: 'Priya Rao', distanceKm: 2.4, people: 3, distanceScore: 12, carpoolScore: 100, finalScore: 47.2, outcome: 'ALLOCATED', slotNumber: 'A-12' },
        { rank: 2, bookingId: 'b2', userId: 'u2', user: 'Sam Lee', distanceKm: 5.1, people: 2, distanceScore: 25.5, carpoolScore: 50, finalScore: 35.3, outcome: 'ALLOCATED', slotNumber: 'A-13' },
        { rank: 3, bookingId: 'b3', userId: 'u3', user: 'Lee Chen', distanceKm: 8.7, people: 1, distanceScore: 43.5, carpoolScore: 0, finalScore: 26.1, outcome: 'WAITLISTED', slotNumber: null },
      ],
    }),
  ),
  http.get(`${baseURL}/me`, () =>
    ok<UserProfile>({
      id: 'mock-user',
      fullName: 'Mock User',
      email: 'user@acme.test',
      contactNumber: '555-0100',
      address: '1 Main St',
      pinCode: '560001',
      distanceKm: 8.5,
      status: 'ACTIVE',
      emailVerified: true,
      companyId: 'mock-co',
      companyName: 'Mock Co',
      role: 'USER',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }),
  ),
  http.get(`${baseURL}/dashboard/user`, () =>
    ok<UserDashboard>({
      upcomingBooking: {
        id: 'mock-booking-1',
        bookingDate: '2026-08-03',
        bookingType: 'PRIMARY',
        status: 'ALLOCATED',
        carpoolMemberCount: 2,
        allocatedSlotNumber: 'A-12',
        createdAt: '2026-07-29T08:00:00.000Z',
      },
      cutoffCountdownSeconds: 3600,
      previousBookingsCount: 2,
    }),
  ),
  http.get(`${baseURL}/me/bookings`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '10');
    const all: Booking[] = [
      {
        id: 'bk-1',
        bookingDate: '2026-08-03',
        bookingType: 'PRIMARY',
        status: 'ALLOCATED',
        carpoolMemberCount: 2,
        allocatedSlotNumber: 'A-12',
        createdAt: '2026-07-29T08:00:00.000Z',
      },
      {
        id: 'bk-2',
        bookingDate: '2026-07-28',
        bookingType: 'PRIMARY',
        status: 'WAITLISTED',
        carpoolMemberCount: 1,
        createdAt: '2026-07-25T08:00:00.000Z',
      },
      {
        id: 'bk-3',
        bookingDate: '2026-07-21',
        bookingType: 'COMMON_POOL',
        status: 'RELEASED',
        carpoolMemberCount: 1,
        createdAt: '2026-07-18T08:00:00.000Z',
      },
    ];
    const start = (page - 1) * pageSize;
    return HttpResponse.json({
      success: true,
      data: all.slice(start, start + pageSize),
      meta: { page, pageSize, total: all.length },
    });
  }),
  http.get(`${baseURL}/config`, () => ok(configSeed)),
  http.patch(`${baseURL}/config`, async ({ request }) => {
    const patch = (await request.json().catch(() => ({}))) as Record<string, string>;
    // Persist in-place so a subsequent GET (React Query refetch after invalidation)
    // reflects the change instead of reverting to the seed. Module-level state — a
    // config-PATCH test should reset it (none exists yet; relevant at P5-10).
    for (const entry of configSeed) {
      const next = patch[entry.key];
      if (next !== undefined) entry.value = next;
    }
    return ok(configSeed);
  }),
];

// MSW matches in order — hero first, generated random handlers as fallback for the rest.
export const handlers = [...hero, ...generated];
