import type { Response } from 'express';
import type { ErrorCode } from './errors';

/** Standard success/error envelope (contract §3.2). `meta` only on list endpoints. */
export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
}

export function sendSuccess<T>(res: Response, data: T, status = 200, meta?: Pagination): Response {
  return res.status(status).json(meta ? { success: true, data, meta } : { success: true, data });
}

export function sendError(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  details?: { field: string; message: string }[],
): Response {
  return res
    .status(status)
    .json({ success: false, error: details ? { code, message, details } : { code, message } });
}
