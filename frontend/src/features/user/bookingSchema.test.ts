import { describe, expect, it } from 'vitest';
import { bookingSchema, MAX_BOOKING_DATES } from './bookingSchema';
import { isBookableWeekday } from '../../lib/dates';

/** 2099-01-05 is a Monday and 2099-01-06 a Tuesday — both far-future bookable weekdays. */
const MON = '2099-01-05';
const TUE = '2099-01-06';

describe('isBookableWeekday', () => {
  it('rejects dates JS silently normalizes (2026-02-31 → Mar 3)', () => {
    expect(isBookableWeekday('2026-02-31')).toBe(false);
  });

  it('accepts a valid far-future weekday (2099-01-05 is a Monday)', () => {
    expect(isBookableWeekday('2099-01-05')).toBe(true);
  });
});

describe('bookingSchema carpool cap refinement', () => {
  it('rejects more carpool members than carpoolPeople - 1 allows', () => {
    const result = bookingSchema.safeParse({
      bookingDates: [MON],
      carpoolPeople: 1,
      carpoolMembers: [{ name: 'X', employeeEmail: 'x@acme.test' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts carpool members within the cap', () => {
    const result = bookingSchema.safeParse({
      bookingDates: [MON],
      carpoolPeople: 2,
      carpoolMembers: [{ name: 'X', employeeEmail: 'x@acme.test' }],
    });
    expect(result.success).toBe(true);
  });

  it('requires an email for each carpool member', () => {
    const result = bookingSchema.safeParse({
      bookingDates: [MON],
      carpoolPeople: 2,
      carpoolMembers: [{ name: 'X', employeeEmail: '' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('bookingSchema multi-date selection', () => {
  const parse = (bookingDates: string[]) => bookingSchema.safeParse({ bookingDates, carpoolPeople: 1 });

  it('accepts several bookable weekdays', () => {
    expect(parse([MON, TUE]).success).toBe(true);
  });

  it('requires at least one date', () => {
    const result = parse([]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toMatch(/at least one date/i);
  });

  it(`caps the selection at ${MAX_BOOKING_DATES} dates, matching the server`, () => {
    // Weekdays only — the count is what must fail, so a weekend slipping in would prove nothing.
    const many: string[] = [];
    for (let i = 0; many.length <= MAX_BOOKING_DATES; i++) {
      const d = new Date(Date.UTC(2099, 0, 5 + i));
      if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) many.push(d.toISOString().slice(0, 10));
    }
    expect(many).toHaveLength(MAX_BOOKING_DATES + 1);
    expect(parse(many).success).toBe(false);
    expect(parse(many.slice(0, MAX_BOOKING_DATES)).success).toBe(true);
  });

  it('rejects a weekend or impossible date anywhere in the list', () => {
    expect(parse([MON, '2099-01-10']).success).toBe(false); // 10 Jan 2099 is a Saturday
    expect(parse([MON, '2026-02-31']).success).toBe(false); // JS would normalise this to 3 Mar
  });
});
