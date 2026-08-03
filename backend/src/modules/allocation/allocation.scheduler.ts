import { getString } from '../../config/systemConfig';
import { logger } from '../../lib/logger';
import { IST_OFFSET_MINUTES } from '../bookings/bookings.time';
import { runCommonPoolAllocation, runPrimaryAllocation } from './allocation.service';

const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60 * 1000;
const DEFAULT_PRIMARY_RESULTS_BY = '20:00';
const DEFAULT_COMMON_POOL_RESULTS_BY = '23:00';
const TICK_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
let running = false;

function istParts(now: Date) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth(),
    date: ist.getUTCDate(),
    minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
  };
}

function timeToMinutes(value: string): number {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]) * 60 + Number(match[2]);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function nextBookableDateFromIstToday(now: Date): string {
  const p = istParts(now);
  const target = new Date(Date.UTC(p.year, p.month, p.date + 1));
  while (target.getUTCDay() === 0 || target.getUTCDay() === 6) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return isoDate(target);
}

async function tick(now = new Date()) {
  if (running) return;
  running = true;
  try {
    const [primaryResultsBy, commonPoolResultsBy] = await Promise.all([
      getString('booking.primaryResultsBy', DEFAULT_PRIMARY_RESULTS_BY),
      getString('booking.commonPoolResultsBy', DEFAULT_COMMON_POOL_RESULTS_BY),
    ]);
    const currentMinutes = istParts(now).minutes;
    const bookingDate = nextBookableDateFromIstToday(now);

    if (currentMinutes >= timeToMinutes(primaryResultsBy ?? DEFAULT_PRIMARY_RESULTS_BY)) {
      await runPrimaryAllocation(bookingDate);
    }
    if (currentMinutes >= timeToMinutes(commonPoolResultsBy ?? DEFAULT_COMMON_POOL_RESULTS_BY)) {
      await runCommonPoolAllocation(bookingDate);
    }
  } catch (error) {
    logger.error({ err: error }, 'Automatic allocation scheduler tick failed');
  } finally {
    running = false;
  }
}

export function startAllocationScheduler() {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  void tick();
  logger.info('Automatic allocation scheduler started');
}

export function stopAllocationScheduler() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  logger.info('Automatic allocation scheduler stopped');
}
