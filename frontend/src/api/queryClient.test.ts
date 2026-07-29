import { describe, expect, it } from 'vitest';
import { ApiError } from './http';
import { shouldRetryQuery } from './queryClient';

describe('shouldRetryQuery', () => {
  it('does not retry a 4xx ApiError', () => {
    expect(shouldRetryQuery(0, new ApiError('x', 'VALIDATION_ERROR', 422))).toBe(false);
  });
  it('retries once for a 5xx ApiError', () => {
    const err = new ApiError('x', 'INTERNAL', 500);
    expect(shouldRetryQuery(0, err)).toBe(true);
    expect(shouldRetryQuery(1, err)).toBe(false);
  });
  it('retries once for a non-ApiError (network/generic) error', () => {
    expect(shouldRetryQuery(0, new Error('network'))).toBe(true);
    expect(shouldRetryQuery(1, new Error('network'))).toBe(false);
  });
});
