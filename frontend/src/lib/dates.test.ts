import { describe, expect, it } from 'vitest';
import { formatCountdown, formatLongCountdown } from './dates';

describe('formatCountdown', () => {
  it('renders m:ss under an hour and h:mm:ss above it', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(9)).toBe('0:09');
    expect(formatCountdown(120)).toBe('2:00');
    expect(formatCountdown(3600)).toBe('1:00:00');
    expect(formatCountdown(3661)).toBe('1:01:01');
  });

  it('clamps negatives to zero', () => {
    expect(formatCountdown(-30)).toBe('0:00');
  });

  it('floors fractional input instead of leaking float noise', () => {
    expect(formatCountdown(3599.9)).toBe('59:59');
    expect(formatCountdown(1.4)).toBe('0:01');
    expect(formatCountdown(NaN)).toBe('0:00');
  });
});

describe('formatLongCountdown', () => {
  it('keeps a multi-day wait readable instead of rolling days into hours', () => {
    // The allocation run can be days out; 455_509s must not read as "126:21:49".
    expect(formatLongCountdown(455_509)).toBe('5d 6h');
    expect(formatLongCountdown(86_400)).toBe('1d 0h');
  });

  it('drops to hours then minutes as the wait shortens', () => {
    expect(formatLongCountdown(22_909)).toBe('6h 21m');
    expect(formatLongCountdown(3600)).toBe('1h 00m');
    expect(formatLongCountdown(1309)).toBe('21m 49s');
    expect(formatLongCountdown(120)).toBe('2m 00s');
    expect(formatLongCountdown(9)).toBe('0m 09s');
  });

  it('clamps negatives to zero', () => {
    expect(formatLongCountdown(-5)).toBe('0m 00s');
  });

  it('floors fractional input instead of leaking float noise', () => {
    expect(formatLongCountdown(3599.9)).toBe('59m 59s');
    expect(formatLongCountdown(1.4)).toBe('0m 01s');
    expect(formatLongCountdown(NaN)).toBe('0m 00s');
  });
});
