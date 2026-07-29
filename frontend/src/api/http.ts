export interface ApiErrorDetail {
  field: string;
  message: string;
}

/** Typed error thrown by `unwrap` for any non-success API response. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: ApiErrorDetail[];
  constructor(message: string, code: string, status: number, details?: ApiErrorDetail[]) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}

interface ErrorEnvelope {
  success: false;
  error: { code: string; message: string; details?: ApiErrorDetail[] };
}
interface SuccessEnvelope<T> {
  success: true;
  data: T;
  meta?: unknown;
}

/** Build an ApiError from an error-envelope body (or a bad success body). */
function toApiError(body: unknown, status: number): ApiError {
  const err = (body as Partial<ErrorEnvelope> | undefined)?.error;
  return new ApiError(err?.message ?? 'Request failed', err?.code ?? 'INTERNAL', status, err?.details);
}

/**
 * Unwrap an openapi-fetch result into `data.data`, or throw a typed ApiError.
 * openapi-fetch returns `{ data, error, response }`; `error` holds the parsed
 * non-2xx body, `data` the 2xx body — both use this API's success/error envelope.
 */
export async function unwrap<T>(
  call: Promise<{ data?: unknown; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await call;
  if (error) throw toApiError(error, response.status);
  const env = data as SuccessEnvelope<T> | undefined;
  if (!env || env.success !== true) throw toApiError(data, response.status);
  return env.data;
}

/** Unwrap a paged list response into `{ items, meta }`. */
export async function unwrapPage<T>(
  call: Promise<{ data?: unknown; error?: unknown; response: Response }>,
): Promise<{ items: T[]; meta: PageMeta }> {
  const { data, error, response } = await call;
  if (error) throw toApiError(error, response.status);
  const env = data as (SuccessEnvelope<T[]> & { meta?: PageMeta }) | undefined;
  if (!env || env.success !== true) throw toApiError(data, response.status);
  const items = env.data ?? [];
  const meta = env.meta ?? { page: 1, pageSize: items.length, total: items.length };
  return { items, meta };
}
