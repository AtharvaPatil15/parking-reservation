import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

/** Attach/echo an X-Correlation-Id on every request (contract §3.1; audited later). */
export const correlationId: RequestHandler = (req, res, next) => {
  const id = req.header('X-Correlation-Id') || randomUUID();
  req.correlationId = id;
  res.setHeader('X-Correlation-Id', id);
  next();
};
