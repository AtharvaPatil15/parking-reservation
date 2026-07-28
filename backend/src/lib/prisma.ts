import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';

/** Single shared Prisma client (P4-03). */
export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
