import request from 'supertest';
import { app } from '../../src/app';
import { prisma } from '../../src/lib/prisma';

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
 * A bookable weekday far enough ahead that the primary window (cutoff 18:00 IST the day before)
 * is always still open. Computed at run time on purpose — a hardcoded date silently rots the whole
 * integration suite into 422 WINDOW_CLOSED the moment its cutoff passes.
 */
export function futureBookableDate(daysAhead = 28): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Wipe transactional data between tests, leaving the seeded baseline (users/slots/quota/config). */
export async function resetTransactional(): Promise<void> {
  await prisma.allocationScoreBreakdown.deleteMany({});
  await prisma.parkingAllocation.deleteMany({});
  await prisma.bookingRequest.deleteMany({});
  await prisma.allocationRun.deleteMany({});
  await prisma.slotBlock.deleteMany({});
}
