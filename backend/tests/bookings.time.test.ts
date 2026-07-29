import { describe, it, expect } from 'vitest';
import {
  isValidCalendarDate,
  isBookableWeekday,
  primaryCutoffInstant,
  isBeforePrimaryCutoff,
} from '../src/modules/bookings/bookings.time';

/**
 * P4-12 — unit tests for the pure booking date/window logic.
 * Anchor dates: 2026-07-31 is a Friday (the hero-flow demo date); 2026-08-01/02 are the
 * following Sat/Sun; 2026-08-03 is the following Monday.
 */

describe('isValidCalendarDate', () => {
  it('accepts real dates', () => {
    expect(isValidCalendarDate('2026-07-31')).toBe(true);
    expect(isValidCalendarDate('2026-02-28')).toBe(true);
  });
  it('rejects bad shapes and impossible dates (round-trip check)', () => {
    expect(isValidCalendarDate('2026-7-31')).toBe(false);
    expect(isValidCalendarDate('2026-02-30')).toBe(false); // Feb has no 30th
    expect(isValidCalendarDate('2026-13-01')).toBe(false); // no month 13
    expect(isValidCalendarDate('not-a-date')).toBe(false);
  });
});

describe('isBookableWeekday (D7)', () => {
  it('is true Mon–Fri', () => {
    expect(isBookableWeekday('2026-07-31')).toBe(true); // Fri
    expect(isBookableWeekday('2026-08-03')).toBe(true); // Mon
    expect(isBookableWeekday('2026-08-04')).toBe(true); // Tue
  });
  it('is false on weekends', () => {
    expect(isBookableWeekday('2026-08-01')).toBe(false); // Sat
    expect(isBookableWeekday('2026-08-02')).toBe(false); // Sun
  });
});

describe('primaryCutoffInstant (F1 — cutoff on the preceding day, IST)', () => {
  it('resolves 18:00 IST on the day before the booking date', () => {
    // 18:00 IST on 2026-07-30 == 12:30:00 UTC on 2026-07-30.
    expect(primaryCutoffInstant('2026-07-31', '18:00').toISOString()).toBe('2026-07-30T12:30:00.000Z');
  });
  it('handles month boundaries on the preceding day', () => {
    // Booking 2026-08-01 → cutoff on 2026-07-31 18:00 IST == 12:30 UTC.
    expect(primaryCutoffInstant('2026-08-01', '18:00').toISOString()).toBe('2026-07-31T12:30:00.000Z');
  });
  it('rejects a malformed cutoff', () => {
    expect(() => primaryCutoffInstant('2026-07-31', '25:00')).toThrow(RangeError);
    expect(() => primaryCutoffInstant('2026-07-31', 'noon')).toThrow(RangeError);
  });
});

describe('isBeforePrimaryCutoff (F2 — strict)', () => {
  const bookingDate = '2026-07-31'; // cutoff instant 2026-07-30T12:30:00Z
  it('is true well before the cutoff', () => {
    // 2026-07-30 11:20 IST == 05:50 UTC.
    expect(isBeforePrimaryCutoff(new Date('2026-07-30T05:50:00.000Z'), bookingDate, '18:00')).toBe(true);
  });
  it('is false at exactly the cutoff instant (strict)', () => {
    expect(isBeforePrimaryCutoff(new Date('2026-07-30T12:30:00.000Z'), bookingDate, '18:00')).toBe(false);
  });
  it('is false one ms before... no — true one ms before, false one ms after', () => {
    expect(isBeforePrimaryCutoff(new Date('2026-07-30T12:29:59.999Z'), bookingDate, '18:00')).toBe(true);
    expect(isBeforePrimaryCutoff(new Date('2026-07-30T12:30:00.001Z'), bookingDate, '18:00')).toBe(false);
  });
});
