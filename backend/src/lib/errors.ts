/** Canonical error codes → HTTP status (contract §3.2). */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'CAPACITY_FULL'
  | 'WINDOW_CLOSED'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export interface ErrorDetail {
  field: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details?: ErrorDetail[]) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}
export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHENTICATED', message);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
  }
}
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
  }
}
export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(409, 'CONFLICT', message);
  }
}
/**
 * Every slot for the requested date is already held (Phase 7 D12). Distinct from CONFLICT so the
 * client can say "pick another date" instead of "you already booked this one".
 */
export class CapacityFullError extends AppError {
  constructor(message = 'No slots remain for this date') {
    super(409, 'CAPACITY_FULL', message);
  }
}
export class WindowClosedError extends AppError {
  constructor(message = 'Action attempted outside its time window') {
    super(422, 'WINDOW_CLOSED', message);
  }
}
