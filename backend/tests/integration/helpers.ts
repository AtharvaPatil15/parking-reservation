import request from 'supertest';
import { app } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { DEFAULT_WINDOW_CONFIG, requestableDates } from '../../src/modules/bookings/bookings.window';
import { getEffectiveQuota } from '../../src/modules/slots/slots.service';

export const API = '/api/v1';
export const DEV_PASSWORD = 'ChangeMe#12345';

/** Log in via the real auth endpoint and return the access token. */
export async function login(email: string, password: string = DEV_PASSWORD): Promise<string> {
  const res = await request(app).post(`${API}/auth/login`).send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.accessToken;
}

/** Authorization header helper. */
export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * A bookable weekday that is inside the currently-open booking window (Phase 7 D9/D11).
 *
 * Derived from the real `requestableDates` rule rather than "today + N days": before Phase 7 the only
 * constraint was the 18:00 cutoff, so any far-future weekday worked. Now a date is open only within
 * `[nextRun + approvalLeadDays, today + windowWeeks*7]` — 28 days ahead is *past* the 2-week horizon
 * and 422s. Sharing the rule with production means the suite cannot drift from it again.
 *
 * Uses `DEFAULT_WINDOW_CONFIG` (not the DB) so it stays synchronous for module-level `const DATE = …`;
 * the test DB is seeded with exactly those defaults.
 *
 * @param offset index into the open window — 0 is the earliest open date, 1 the next, and so on.
 *               Use a distinct offset when a test needs two dates that must not collide.
 */
export function futureBookableDate(offset = 0): string {
  const dates = requestableDates(new Date(), DEFAULT_WINDOW_CONFIG);
  if (dates.length === 0) {
    throw new Error('No requestable dates in the current booking window — check the window config');
  }
  if (offset >= dates.length) {
    throw new Error(
      `Requested open date #${offset} but only ${dates.length} are open (${dates.join(', ')})`,
    );
  }
  return dates[offset];
}

/**
 * Block a company's quota for `date` down to exactly `leave` available slots, whatever the seeded
 * quota happens to be.
 *
 * Tests that force a waitlist care about the *remaining* capacity, not the block count. Hardcoding
 * "block 7 of 8" silently stopped forcing a waitlist the moment the seed quota moved to 12, and the
 * failure looked like an allocation bug rather than a stale fixture. Reads the quota through the real
 * `getEffectiveQuota` so it also follows any effective-dating rule change.
 */
export async function blockQuotaDownTo(
  saToken: string,
  companyId: string,
  date: string,
  leave = 1,
): Promise<void> {
  const quota = await getEffectiveQuota(companyId, new Date(`${date}T00:00:00.000Z`));
  const blockedCount = quota - leave;
  if (blockedCount <= 0) {
    throw new Error(`Quota for ${companyId} on ${date} is ${quota}; cannot block down to ${leave}`);
  }
  const res = await request(app)
    .post(`${API}/companies/${companyId}/blocks`)
    .set(bearer(saToken))
    .send({ blockedCount, startDate: date, endDate: date, reason: 'OTHER' });
  if (res.status !== 201) {
    throw new Error(`blockQuotaDownTo failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

/**
 * Wipe transactional data between tests, leaving the seeded baseline (users/slots/quota/config).
 *
 * `gateEvent` was missing here until 2026-08-05, which made gate state leak across tests: a car checked
 * in by one `it` stayed checked in, so the next attempt on the same plate came back `409 already checked
 * in` — a failure that looks like a bug in whatever you were actually testing.
 *
 * `vehicleRegistrationRequest` for the same reason: a leaked PENDING row holds its plate at the barrier
 * for the rest of the run.
 */
export async function resetTransactional(): Promise<void> {
  await prisma.allocationScoreBreakdown.deleteMany({});
  await prisma.parkingAllocation.deleteMany({});
  await prisma.bookingRequest.deleteMany({});
  await prisma.allocationRun.deleteMany({});
  await prisma.slotBlock.deleteMany({});
  await prisma.gateEvent.deleteMany({});
  await prisma.vehicleRegistrationRequest.deleteMany({});
}
