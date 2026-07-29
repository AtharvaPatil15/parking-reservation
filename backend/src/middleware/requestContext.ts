import type { RequestHandler } from 'express';
import { requestContextStore } from '../lib/requestContext';

/**
 * Establish the per-request AsyncLocalStorage context. Must run AFTER correlationId
 * (so req.correlationId is set). `actorUserId` is filled in later by `authenticate`.
 */
export const requestContext: RequestHandler = (req, _res, next) => {
  requestContextStore.run({ ip: req.ip, correlationId: req.correlationId }, () => next());
};
