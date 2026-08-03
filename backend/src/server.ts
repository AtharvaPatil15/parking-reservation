import { app } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { startAllocationScheduler, stopAllocationScheduler } from './modules/allocation/allocation.scheduler';

const server = app.listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  startAllocationScheduler();
});

async function shutdown(signal: string) {
  stopAllocationScheduler();
  logger.info(`${signal} received — shutting down`);
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
