import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCountdown } from './useCountdown';

describe('useCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticks down to 0 and then stops (no further updates past 0)', () => {
    const { result } = renderHook(() => useCountdown(2));
    expect(result.current).toBe(2);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(0);

    // Advancing well past 0 must not go negative or otherwise change — interval should be cleared.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(0);
  });

  it('returns null when initialSeconds is null/undefined', () => {
    const { result } = renderHook(() => useCountdown(null));
    expect(result.current).toBeNull();
  });
});
