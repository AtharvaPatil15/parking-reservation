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

interface ErrorEnvelope {
  success: false;
  error: { code: string; message: string; details?: ApiErrorDetail[] };
}
interface SuccessEnvelope<T> {
  success: true;
  data: T;
  meta?: unknown;
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
  if (error) {
    const env = error as Partial<ErrorEnvelope>;
    throw new ApiError(
      env?.error?.message ?? 'Request failed',
      env?.error?.code ?? 'INTERNAL',
      response.status,
      env?.error?.details,
    );
  }
  const env = data as SuccessEnvelope<T> | ErrorEnvelope | undefined;
  if (!env || env.success !== true) {
    const err = (env as ErrorEnvelope | undefined)?.error;
    throw new ApiError(
      err?.message ?? 'Unexpected response',
      err?.code ?? 'INTERNAL',
      response.status,
      err?.details,
    );
  }
  return env.data;
}
