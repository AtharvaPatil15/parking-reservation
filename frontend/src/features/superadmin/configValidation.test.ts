import { describe, expect, it } from 'vitest';
import { validateConfigValue, validateTimingOrder, labelForKey } from './configValidation';

describe('labelForKey', () => {
  it('humanizes keys and never returns the raw dotted key', () => {
    expect(labelForKey('booking.primaryCutoff')).toBe('Primary cutoff'); // curated
    expect(labelForKey('allocation.distanceWeight')).toBe('Distance weight');
    expect(labelForKey('carpool.maxPeople')).toBe('Max people');
    expect(labelForKey('password.minLength')).toBe('Min length');
    expect(labelForKey('allocation.distanceWeight')).not.toContain('.');
  });
});

describe('validateConfigValue', () => {
  it('rejects empty values', () => {
    expect(validateConfigValue('carpool.maxPeople', 'NUMBER', '')).toBe('Required');
  });

  it('rejects non-numbers for NUMBER', () => {
    expect(validateConfigValue('booking.reminderBefore', 'NUMBER', 'abc')).toBe('Must be a number');
  });

  it('rejects malformed times', () => {
    expect(validateConfigValue('booking.primaryCutoff', 'TIME', '25:00')).toBe('Must be HH:MM (24-hour)');
    expect(validateConfigValue('booking.primaryCutoff', 'TIME', '13:00')).toBeNull();
  });

  it('bounds weights to 0..1', () => {
    expect(validateConfigValue('allocation.distanceWeight', 'NUMBER', '2')).toBe('Weight must be between 0 and 1');
    expect(validateConfigValue('allocation.carpoolWeight', 'NUMBER', '0.4')).toBeNull();
  });

  it('requires maxPeople to be an integer ≥ 2', () => {
    expect(validateConfigValue('carpool.maxPeople', 'NUMBER', '1')).toBe('Must be an integer ≥ 2');
    expect(validateConfigValue('carpool.maxPeople', 'NUMBER', '4')).toBeNull();
  });

  it('requires maxDistanceKm > 0', () => {
    expect(validateConfigValue('allocation.maxDistanceKm', 'NUMBER', '0')).toBe('Must be greater than 0');
    expect(validateConfigValue('allocation.maxDistanceKm', 'NUMBER', '40')).toBeNull();
  });
});

describe('validateTimingOrder', () => {
  const ordered = {
    'booking.primaryCutoff': '13:00',
    'booking.primaryResultsBy': '14:00',
    'booking.commonPoolClose': '16:00',
    'booking.commonPoolResultsBy': '17:00',
  };

  it('passes when strictly ordered', () => {
    expect(validateTimingOrder(ordered)).toEqual({});
  });

  it('flags all timing keys when out of order', () => {
    const bad = { ...ordered, 'booking.primaryResultsBy': '12:00' };
    const errs = validateTimingOrder(bad);
    expect(Object.keys(errs)).toHaveLength(4);
    expect(errs['booking.primaryCutoff']).toMatch(/out of order/i);
  });

  it('stays silent when a time is unparseable (per-field check handles it)', () => {
    const bad = { ...ordered, 'booking.commonPoolClose': 'nope' };
    expect(validateTimingOrder(bad)).toEqual({});
  });

  /**
   * The run-time pair is a separate rule over separate keys: the pool shares out what the primary run
   * waitlists, so it can never run first.
   */
  describe('common-pool run time vs the allocation run', () => {
    const runTimes = { 'booking.allocationRunTime': '20:00', 'booking.commonPoolRunTime': '22:00' };

    it('accepts the pool at or after the allocation run', () => {
      expect(validateTimingOrder({ ...ordered, ...runTimes })).toEqual({});
      expect(
        validateTimingOrder({ ...ordered, ...runTimes, 'booking.commonPoolRunTime': '20:00' }),
      ).toEqual({});
    });

    it('flags a pool time before the allocation run', () => {
      const errs = validateTimingOrder({ ...ordered, ...runTimes, 'booking.commonPoolRunTime': '19:59' });
      expect(errs['booking.commonPoolRunTime']).toMatch(/at or after the allocation run time/i);
      // Only that field — the legacy ordering is untouched and must not be co-flagged.
      expect(Object.keys(errs)).toEqual(['booking.commonPoolRunTime']);
    });

    it('is evaluated even when a legacy timing value is unparseable', () => {
      // The two rules are independent; one being unusable must not silence the other.
      const errs = validateTimingOrder({
        ...ordered,
        ...runTimes,
        'booking.commonPoolClose': 'nope',
        'booking.commonPoolRunTime': '01:00',
      });
      expect(errs['booking.commonPoolRunTime']).toMatch(/at or after/i);
    });
  });
});
