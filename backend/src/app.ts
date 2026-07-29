import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './lib/logger';
import { correlationId } from './middleware/correlationId';
import { requestContext } from './middleware/requestContext';
import { errorHandler, notFound } from './middleware/errorHandler';
import { sendError } from './lib/response';
import configRoutes from './modules/config/config.routes';
import authRoutes from './modules/auth/auth.routes';
import companiesRoutes from './modules/companies/companies.routes';
import usersRoutes from './modules/users/users.routes';
import { slotsRouter, companyScopedRouter, blockItemRouter } from './modules/slots/slots.routes';
import dashboardRoutes from './modules/dashboards/dashboards.routes';
import bookingsRoutes from './modules/bookings/bookings.routes';
import allocationRoutes from './modules/allocation/allocation.routes';

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(correlationId);
app.use(requestContext);
app.use(
  pinoHttp({
    logger,
    customProps: (req) => ({ correlationId: (req as express.Request).correlationId }),
  }),
);

// Liveness (no auth, no DB dependency).
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Rate limiting → standard 429 envelope (contract §3.2). Tightened per-route in later tasks.
const limiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => sendError(res, 429, 'RATE_LIMITED', 'Too many requests'),
});

const api = express.Router();
api.use(limiter);
api.use('/auth', authRoutes);
api.use('/config', configRoutes);
api.use('/companies', companiesRoutes); // CRUD + /active + /:id/users + /:id/admins
api.use('/companies', companyScopedRouter); // /:id/quota + /:id/blocks
api.use('/users', usersRoutes); // /:id/approval + /:id/status
api.use('/slots', slotsRouter);
api.use('/blocks', blockItemRouter); // DELETE /:id
api.use('/dashboard', dashboardRoutes);
api.use('/bookings', bookingsRoutes);
api.use('/allocation', allocationRoutes);

app.use('/api/v1', api);

app.use(notFound);
app.use(errorHandler);
