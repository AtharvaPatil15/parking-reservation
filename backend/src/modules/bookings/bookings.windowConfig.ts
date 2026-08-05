import { getNumber, getString } from '../../config/systemConfig';
import { DEFAULT_CAPS, DEFAULT_WEIGHTS } from '../allocation/score';
import {
  DEFAULT_WINDOW_CONFIG,
  type RunDay,
  type RunFrequency,
  type ScoringSummary,
  type WindowConfig,
} from './bookings.window';

const RUN_DAYS: RunDay[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

/**
 * Read the booking-window settings out of SystemConfiguration (D8 — never hardcoded, Super-Admin
 * editable at runtime). Kept apart from `bookings.window.ts` so that module stays pure/testable.
 * Malformed or missing rows fall back to the seeded defaults rather than throwing — a bad config row
 * must not take the booking form down.
 */
const HH_MM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

const toMinutes = (hhmm: string): number => {
  const [hh, mm] = hhmm.split(':');
  return Number(hh) * 60 + Number(mm);
};

export async function loadWindowConfig(): Promise<WindowConfig> {
  const [weeks, runDay, runFrequency, runTime, poolRunTime, leadDays] = await Promise.all([
    getNumber('booking.windowWeeks'),
    getString('booking.allocationRunDay'),
    getString('booking.allocationRunFrequency'),
    getString('booking.allocationRunTime'),
    getString('booking.commonPoolRunTime'),
    getNumber('booking.approvalLeadDays'),
  ]);

  const resolvedRunTime = runTime && HH_MM.test(runTime) ? runTime : DEFAULT_WINDOW_CONFIG.runTime;

  return {
    windowWeeks: weeks === 2 || weeks === 4 ? weeks : DEFAULT_WINDOW_CONFIG.windowWeeks,
    runDay: RUN_DAYS.includes(runDay as RunDay) ? (runDay as RunDay) : DEFAULT_WINDOW_CONFIG.runDay,
    runFrequency:
      runFrequency === 'WEEKLY' || runFrequency === 'BIWEEKLY' || runFrequency === 'MONTHLY'
        ? (runFrequency as RunFrequency)
        : DEFAULT_WINDOW_CONFIG.runFrequency,
    runTime: resolvedRunTime,
    // Falls back to the primary run time, not to the seeded default: with a custom `runTime` the seeded
    // '20:00' could land *before* primary, and "pool runs with primary" is the safe reading of a missing
    // or malformed row. The ordering rule is enforced on write; this is the read-side backstop.
    commonPoolRunTime:
      poolRunTime && HH_MM.test(poolRunTime) && toMinutes(poolRunTime) >= toMinutes(resolvedRunTime)
        ? poolRunTime
        : resolvedRunTime,
    approvalLeadDays:
      leadDays != null && Number.isInteger(leadDays) && leadDays >= 1 && leadDays <= 6
        ? leadDays
        : DEFAULT_WINDOW_CONFIG.approvalLeadDays,
  };
}

/**
 * Read the live scoring weights and caps (P8-04), so the booking form can show a user their score
 * *before* they submit.
 *
 * Deliberately the same keys and the same fallbacks the allocation run uses — if these two ever
 * disagree, the number the user was shown is not the number they were ranked on, which is worse than
 * showing no number at all. Anything invalid falls back rather than throwing, for the same reason
 * `loadWindowConfig` does: a bad config row must not take the booking form down.
 */
export async function loadScoringConfig(): Promise<ScoringSummary> {
  const [distanceWeight, carpoolWeight, maxDistanceKm, maxPeople] = await Promise.all([
    getNumber('allocation.distanceWeight'),
    getNumber('allocation.carpoolWeight'),
    getNumber('allocation.maxDistanceKm'),
    getNumber('carpool.maxPeople'),
  ]);

  return {
    distanceWeight: distanceWeight ?? DEFAULT_WEIGHTS.distanceWeight,
    carpoolWeight: carpoolWeight ?? DEFAULT_WEIGHTS.carpoolWeight,
    // A zero or negative cap would make `score()` throw, so guard the divisor rather than trusting it.
    maxDistanceKm: maxDistanceKm != null && maxDistanceKm > 0 ? maxDistanceKm : DEFAULT_CAPS.maxDistanceKm,
    maxPeople: maxPeople != null && maxPeople >= 2 ? maxPeople : DEFAULT_CAPS.maxPeople,
  };
}
