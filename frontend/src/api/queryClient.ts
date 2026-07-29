import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './http';

/** Retry policy: never retry a 4xx ApiError (won't fix itself); otherwise retry once. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

/** Shared React Query client. No retry on 4xx (client errors won't fix themselves). */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: shouldRetryQuery,
    },
    mutations: { retry: false },
  },
});
