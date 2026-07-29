import { HttpResponse, http } from 'msw';
import { handlers as generated } from './handlers.generated';

const baseURL = '/api/v1';
const ok = (data: unknown, status = 200) => HttpResponse.json({ success: true, data }, { status });
const fail = (status: number, code: string, message: string) =>
  HttpResponse.json({ success: false, error: { code, message } }, { status });

function roleForEmail(email: string): 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'USER' {
  if (email.startsWith('admin@')) return 'SUPER_ADMIN';
  if (email.startsWith('company@')) return 'COMPANY_ADMIN';
  return 'USER';
}

/** Coherent, deterministic handlers for the hero flow (override the generated random ones). */
const hero = [
  http.post(`${baseURL}/auth/login`, async ({ request }) => {
    const body = (await request.json().catch(() => null)) as { email?: string; password?: string } | null;
    if (!body?.email || !body?.password) return fail(401, 'UNAUTHENTICATED', 'Invalid credentials');
    const role = roleForEmail(body.email);
    return ok({
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
    return ok(
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
  http.post(`${baseURL}/allocation/primary/run`, () =>
    ok({
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
    ok({
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
  http.get(`${baseURL}/config`, () =>
    ok([
      { key: 'primary.window.open', value: '18:00', valueType: 'TIME' },
      { key: 'primary.window.cutoff', value: '21:00', valueType: 'TIME' },
      { key: 'scoring.distanceWeight', value: '0.6', valueType: 'NUMBER' },
      { key: 'scoring.carpoolWeight', value: '0.4', valueType: 'NUMBER' },
      { key: 'carpool.maxPeople', value: '4', valueType: 'NUMBER' },
    ]),
  ),
  http.patch(`${baseURL}/config`, async ({ request }) => {
    const patch = (await request.json().catch(() => ({}))) as Record<string, string>;
    return ok(Object.entries(patch).map(([key, value]) => ({ key, value, valueType: 'STRING' })));
  }),
];

// MSW matches in order — hero first, generated random handlers as fallback for the rest.
export const handlers = [...hero, ...generated];
