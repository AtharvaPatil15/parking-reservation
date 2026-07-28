import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';
import { sendError } from '../lib/response';
import { logger } from '../lib/logger';

/** 404 for unmatched routes. */
export const notFound: RequestHandler = (req, res) => {
  sendError(res, 404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`);
};

/** Central error handler → standard error envelope (contract §3.2). */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    return sendError(res, err.status, err.code, err.message, err.details);
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return sendError(res, 400, 'VALIDATION_ERROR', 'Request validation failed', details);
  }
  logger.error({ err, correlationId: req.correlationId }, 'Unhandled error');
  return sendError(res, 500, 'INTERNAL', 'Internal server error');
};
