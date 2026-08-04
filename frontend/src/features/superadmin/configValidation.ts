/**
 * Client-side config validation mirroring the backend `config.service.ts`
 * `validateValue` + timing-order rules (D8), so the Super-Admin config screen
 * gives inline feedback before PATCH /config — and matches what the live API
 * will accept after P5-13. The backend remains the source of truth; this only
 * front-runs its errors.
 */

/** The four timing keys, in required ascending order. */
const TIMING_KEYS = [
  'booking.primaryCutoff',
  'booking.primaryResultsBy',
  'booking.commonPoolClose',
  'booking.commonPoolResultsBy',
] as const;

const TIMING_LABELS: Record<string, string> = {
  'booking.primaryCutoff': 'Primary cutoff',
  'booking.primaryResultsBy': 'Primary results by',
  'booking.commonPoolClose': 'Common-pool close',
  'booking.commonPoolResultsBy': 'Common-pool results by',
  // Phase 7 — spelled out because the humanized fallback ("Window weeks") loses the meaning.
  'booking.windowWeeks': 'Booking window (weeks ahead)',
  'booking.allocationRunFrequency': 'Automatic allocation interval',
  'booking.allocationRunDay': 'Weekly allocation run day',
  'booking.allocationRunTime': 'Weekly allocation run time',
  'booking.approvalLeadDays': 'Decision lead time (days)',
};

function toMinutes(hhmm: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Per-field type + range validation. Returns an error message, or null when valid. */
export function validateConfigValue(key: string, valueType: string, v: string): string | null {
  if (v.trim() === '') return 'Required';
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
      if (!Number.isInteger(n) || n < 2) return 'Must be an integer ≥ 2';
      break;
    }
    case 'booking.reminderBefore': {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) return 'Must be a non-negative integer';
      break;
    }
    case 'password.minLength': {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) return 'Must be an integer ≥ 1';
      break;
    }
    // ---- Phase 7: booking window + weekly allocation run ----
    case 'booking.windowWeeks':
      if (v !== '2' && v !== '4') return 'Must be 2 or 4 weeks';
      break;
    case 'booking.allocationRunDay':
      if (!['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'].includes(v)) {
        return 'Must be a weekday';
      }
      break;
    case 'booking.allocationRunFrequency':
      if (v !== 'WEEKLY' && v !== 'BIWEEKLY' && v !== 'MONTHLY') return 'Must be weekly, biweekly, or monthly';
      break;
    case 'booking.approvalLeadDays': {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 6) return 'Must be an integer between 1 and 6';
      break;
    }
    default:
      break;
  }
  return null;
}

/**
 * Keys whose value is a fixed set, so the config screen can offer a picker instead of a free-text
 * box — the two Phase 7 keys where a typo would be silently accepted as "fall back to the default".
 */
export const ENUM_CONFIG_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  'booking.windowWeeks': [
    { value: '2', label: '2 weeks' },
    { value: '4', label: '4 weeks' },
  ],
  'booking.allocationRunDay': [
    { value: 'MONDAY', label: 'Monday' },
    { value: 'TUESDAY', label: 'Tuesday' },
    { value: 'WEDNESDAY', label: 'Wednesday' },
    { value: 'THURSDAY', label: 'Thursday' },
    { value: 'FRIDAY', label: 'Friday' },
    { value: 'SATURDAY', label: 'Saturday' },
    { value: 'SUNDAY', label: 'Sunday' },
  ],
  'booking.allocationRunFrequency': [
    { value: 'WEEKLY', label: 'Weekly' },
    { value: 'BIWEEKLY', label: 'Biweekly' },
    { value: 'MONTHLY', label: 'Monthly' },
  ],
};

/**
 * Cross-field timing-order check over the merged config (current values overlaid
 * with edits). When the order is violated, returns the same message keyed on ALL
 * four timing keys (so every timing field is flagged inline). Returns an empty
 * object when the order holds, or when any timing value is unparseable (per-field
 * validation surfaces the malformed one).
 */
export function validateTimingOrder(values: Record<string, string>): Record<string, string> {
  const mins = TIMING_KEYS.map((k) => toMinutes(values[k] ?? ''));
  if (mins.some((m) => m === null)) return {};
  const [pc, pr, cc, cr] = mins as number[];
  if (pc < pr && pr <= cc && cc < cr) return {};
  // Flag the timing fields so the user sees which rule broke inline.
  const message = 'Out of order (cutoff < results by ≤ pool close < pool results by)';
  return Object.fromEntries(TIMING_KEYS.map((k) => [k, message]));
}

/**
 * Human label for a config key — never the raw dotted key. Uses the curated timing labels,
 * else humanizes the last segment (e.g. `allocation.distanceWeight` → "Distance weight",
 * `carpool.maxPeople` → "Max people").
 */
export function labelForKey(key: string): string {
  if (TIMING_LABELS[key]) return TIMING_LABELS[key];
  const last = key.split('.').pop() ?? key;
  const words = last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
