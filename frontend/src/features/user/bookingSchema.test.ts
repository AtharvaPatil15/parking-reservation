import { describe, expect, it } from 'vitest';
import { bookingSchema } from './bookingSchema';
import { isBookableWeekday } from '../../lib/dates';

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
      bookingDate: '2099-01-05',
      carpoolPeople: 1,
      carpoolMembers: [{ name: 'X', employeeEmail: 'x@acme.test' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts carpool members within the cap', () => {
    const result = bookingSchema.safeParse({
      bookingDate: '2099-01-05',
      carpoolPeople: 2,
      carpoolMembers: [{ name: 'X', employeeEmail: 'x@acme.test' }],
    });
    expect(result.success).toBe(true);
  });

  it('requires an email for each carpool member', () => {
    const result = bookingSchema.safeParse({
      bookingDate: '2099-01-05',
      carpoolPeople: 2,
      carpoolMembers: [{ name: 'X', employeeEmail: '' }],
    });
    expect(result.success).toBe(false);
  });
});
