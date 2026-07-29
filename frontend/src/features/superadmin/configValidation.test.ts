import { describe, expect, it } from 'vitest';
import { validateConfigValue, validateTimingOrder } from './configValidation';

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
});
