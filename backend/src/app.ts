import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit, { MemoryStore } from 'express-rate-limit';
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
import { slotsRouter, parkingAreasRouter, companyScopedRouter, blockItemRouter } from './modules/slots/slots.routes';
import dashboardRoutes from './modules/dashboards/dashboards.routes';
import meRoutes from './modules/me/me.routes';
import bookingsRoutes, { availabilityRouter } from './modules/bookings/bookings.routes';
import allocationRoutes, { allocationsRouter } from './modules/allocation/allocation.routes';
import { gateRouter, vehiclesRouter } from './modules/gate/gate.routes';

export const app = express();

// Must precede the limiters: it decides whether `req.ip` is the socket address or the last hop in
// X-Forwarded-For, and therefore what the per-IP rate-limit keys are actually keyed on.
if (env.TRUST_PROXY) app.set('trust proxy', 1);

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

// Rate limiting → standard 429 envelope (contract §3.2).
const limiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => sendError(res, 429, 'RATE_LIMITED', 'Too many requests'),
});

const tooManyAttempts = (_req: express.Request, res: express.Response) =>
  sendError(res, 429, 'RATE_LIMITED', 'Too many attempts; try again later');

// Explicit stores so the counters can be cleared. The integration suite runs every file in one
// process (`singleFork`), so without this the auth counters accumulate across the whole run and a
// late test file starts seeing 429s from registrations made by an earlier one.
const loginStore = new MemoryStore();
const registerStore = new MemoryStore();

/** Clear the auth attempt counters. For tests — production has no reason to call this. */
export function resetAuthRateLimits(): void {
  loginStore.resetAll();
  registerStore.resetAll();
}

/**
 * Credential limiter for POST /auth/login.
 *
 * The global 300/min above is a traffic ceiling, not brute-force protection — it still permits
 * ~430k password guesses per day per IP against an 8-character minimum. This is the actual
 * guard.
 *
 * Keyed on IP **plus** the submitted email. What that buys is per-account budgets within an
 * address: an attacker hammering one colleague's account cannot spend the whole office NAT's
 * allowance and lock everyone else out of logging in. `skipSuccessfulRequests` means only failures
 * count, so a legitimate user signing in repeatedly is never throttled by their own activity.
 *
 * What it does **not** buy: this is not an account-wide budget. A caller with a pool of addresses
 * still gets a fresh 10 per address for the same email, so distributed credential stuffing is only
 * slowed, not stopped. Closing that needs a second limiter keyed on the email alone, which is
 * deliberately not here — an email-only budget is a targeted lockout: anyone who knows your address
 * could burn it from anywhere and keep you from signing in for the window. Trading a guaranteed
 * lockout vector for a partial mitigation is the wrong way round at this app's scale. If it is ever
 * wanted, the shape to reach for is a high account-wide ceiling that only trips on volume no real
 * person produces, and it needs its own decision — not a silent addition here.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  store: loginStore,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return `${req.ip}:${email}`;
  },
  handler: tooManyAttempts,
});

/**
 * Registration limiter. Different threat from login: /register answers 409 for an address that is
 * already taken, so an unmetered endpoint is an account-enumeration oracle as well as a spam
 * vector. Keyed on IP alone — there is no prior account to key against.
 */
const registerLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 50,
  store: registerStore,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyAttempts,
});

const api = express.Router();
api.use(limiter);
// Ahead of the auth router so the tighter limits win. `express.json()` has already run at app
// level, so `req.body.email` is populated for the login key.
api.use('/auth/login', loginLimiter);
api.use('/auth/register', registerLimiter);
api.use('/auth', authRoutes);
api.use('/config', configRoutes);
api.use('/companies', companiesRoutes); // CRUD + /active + /:id/users + /:id/admins
api.use('/companies', companyScopedRouter); // /:id/quota + /:id/blocks
api.use('/users', usersRoutes); // /:id/approval + /:id/status
api.use('/slots', slotsRouter);
api.use('/parking-areas', parkingAreasRouter); // GET — area picker for slot creation
api.use('/blocks', blockItemRouter); // DELETE /:id
api.use('/dashboard', dashboardRoutes);
api.use('/me', meRoutes); // GET/PATCH profile + GET /me/bookings (own history)
api.use('/bookings', bookingsRoutes);
api.use('/availability', availabilityRouter); // per-date slot grid for the caller's company (Phase 7)
api.use('/allocation', allocationRoutes);
api.use('/allocations', allocationsRouter); // per-slot roster — CA (own) / SA (all)
api.use('/vehicles', vehiclesRouter); // car registry the gate reads (Phase 7)
api.use('/gate', gateRouter); // check-in / check-out + unbooked-entry feed (Phase 7)

app.use('/api/v1', api);

app.use(notFound);
app.use(errorHandler);
