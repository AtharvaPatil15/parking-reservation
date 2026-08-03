import { getNumber, getString } from '../../config/systemConfig';
import { DEFAULT_WINDOW_CONFIG, type RunDay, type RunFrequency, type WindowConfig } from './bookings.window';

const RUN_DAYS: RunDay[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

/**
 * Read the booking-window settings out of SystemConfiguration (D8 — never hardcoded, Super-Admin
 * editable at runtime). Kept apart from `bookings.window.ts` so that module stays pure/testable.
 * Malformed or missing rows fall back to the seeded defaults rather than throwing — a bad config row
 * must not take the booking form down.
 */
export async function loadWindowConfig(): Promise<WindowConfig> {
  const [weeks, runDay, runFrequency, runTime, leadDays] = await Promise.all([
    getNumber('booking.windowWeeks'),
    getString('booking.allocationRunDay'),
    getString('booking.allocationRunFrequency'),
    getString('booking.allocationRunTime'),
    getNumber('booking.approvalLeadDays'),
  ]);

  return {
    windowWeeks: weeks === 2 || weeks === 4 ? weeks : DEFAULT_WINDOW_CONFIG.windowWeeks,
    runDay: RUN_DAYS.includes(runDay as RunDay) ? (runDay as RunDay) : DEFAULT_WINDOW_CONFIG.runDay,
    runFrequency:
      runFrequency === 'WEEKLY' || runFrequency === 'BIWEEKLY' || runFrequency === 'MONTHLY'
        ? (runFrequency as RunFrequency)
        : DEFAULT_WINDOW_CONFIG.runFrequency,
    runTime: runTime && /^([01]?\d|2[0-3]):([0-5]\d)$/.test(runTime) ? runTime : DEFAULT_WINDOW_CONFIG.runTime,
    approvalLeadDays:
      leadDays != null && Number.isInteger(leadDays) && leadDays >= 1 && leadDays <= 6
        ? leadDays
        : DEFAULT_WINDOW_CONFIG.approvalLeadDays,
  };
}
