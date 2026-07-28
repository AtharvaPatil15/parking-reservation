import { prisma } from '../../lib/prisma';
import { ValidationError, type ErrorDetail } from '../../lib/errors';
import { invalidateConfig } from '../../config/systemConfig';

/**
 * Config service (P4-02). Reads/updates SystemConfiguration with D8 validation:
 *  - timing keys must satisfy primaryCutoff < primaryResultsBy <= commonPoolClose < commonPoolResultsBy
 *  - value must match its stored valueType (NUMBER/TIME/BOOLEAN)
 *  - key-specific ranges (weights 0..1, maxDistanceKm > 0, maxPeople >= 2, etc.)
 * Only keys that already exist (seeded) may be updated; unknown keys are rejected.
 */
const TIME_KEYS = [
  'booking.primaryCutoff',
  'booking.primaryResultsBy',
  'booking.commonPoolClose',
  'booking.commonPoolResultsBy',
] as const;

function toMinutes(hhmm: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function validateValue(key: string, valueType: string, v: string): string | null {
  if (valueType === 'NUMBER' && Number.isNaN(Number(v))) return 'Must be a number';
  if (valueType === 'BOOLEAN' && v !== 'true' && v !== 'false') return 'Must be true or false';
  if (valueType === 'TIME' && toMinutes(v) === null) return 'Must be HH:MM (24-hour)';

  switch (key) {
    case 'allocation.distanceWeight':
    case 'allocation.carpoolWeight': {
      const n = Number(v);
      if (n < 0 || n > 1) return 'Weight must be between 0 and 1';
      break;
    }
    case 'allocation.maxDistanceKm':
      if (!(Number(v) > 0)) return 'Must be greater than 0';
      break;
    case 'carpool.maxPeople': {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 2) return 'Must be an integer >= 2';
      break;
    }
    case 'booking.reminderBefore': {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) return 'Must be a non-negative integer';
      break;
    }
    case 'password.minLength': {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) return 'Must be an integer >= 1';
      break;
    }
    default:
      break;
  }
  return null;
}

export function getAll() {
  return prisma.systemConfiguration.findMany({ orderBy: { key: 'asc' } });
}

export async function updateConfig(input: Record<string, string>, actorUserId?: string) {
  const keys = Object.keys(input);
  if (keys.length === 0) throw new ValidationError('At least one configuration key is required');

  const existing = await prisma.systemConfiguration.findMany();
  const byKey = new Map(existing.map((r) => [r.key, r]));

  const details: ErrorDetail[] = [];

  // Reject unknown keys.
  for (const k of keys) {
    if (!byKey.has(k)) details.push({ field: k, message: 'Unknown configuration key' });
  }
  if (details.length) throw new ValidationError('Unknown configuration key(s)', details);

  // Per-value type/range validation.
  for (const k of keys) {
    const err = validateValue(k, byKey.get(k)!.valueType, input[k]);
    if (err) details.push({ field: k, message: err });
  }

  // Merged timing-order validation (existing values overlaid with the incoming changes).
  const merged = (key: string) => input[key] ?? byKey.get(key)?.value ?? '';
  const mins = TIME_KEYS.map((k) => toMinutes(merged(k)));
  if (mins.every((m) => m !== null)) {
    const [pc, pr, cc, cr] = mins as number[];
    if (!(pc < pr && pr <= cc && cc < cr)) {
      details.push({
        field: 'booking.*',
        message:
          'Times must satisfy primaryCutoff < primaryResultsBy <= commonPoolClose < commonPoolResultsBy',
      });
    }
  }

  if (details.length) throw new ValidationError('Configuration validation failed', details);

  await prisma.$transaction(
    keys.map((k) =>
      prisma.systemConfiguration.update({
        where: { key: k },
        data: { value: input[k], updatedById: actorUserId },
      }),
    ),
  );
  invalidateConfig();
  return getAll();
}
