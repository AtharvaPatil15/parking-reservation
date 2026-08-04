import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, ErrorState, Input, LoadingState, Select, useToast } from '../../components';
import { useConfig, useUpdateConfig } from '../../api/hooks';
import { ApiError } from '../../api/http';
import type { components } from '../../api/types';
import { ENUM_CONFIG_OPTIONS, labelForKey, validateConfigValue, validateTimingOrder } from './configValidation';

type ConfigEntry = components['schemas']['ConfigEntry'];

const DEFAULT_RUN_ENTRIES: ConfigEntry[] = [
  {
    key: 'booking.allocationRunFrequency',
    value: 'WEEKLY',
    valueType: 'STRING',
    description: 'Automatic allocation run interval',
  },
  {
    key: 'booking.allocationRunDay',
    value: 'SUNDAY',
    valueType: 'STRING',
    description: 'Automatic allocation run day',
  },
];

const BOOLEAN_OPTIONS = [
  { value: 'true', label: 'true' },
  { value: 'false', label: 'false' },
];

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const RUN_KEYS = ['booking.allocationRunFrequency', 'booking.allocationRunDay', 'booking.allocationRunTime'];

function inputType(valueType: string): string {
  if (valueType === 'TIME') return 'time';
  if (valueType === 'NUMBER') return 'number';
  return 'text';
}

function parseTime(time: string): [number, number] | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function runDayIndex(day: string): number {
  return {
    SUNDAY: 0,
    MONDAY: 1,
    TUESDAY: 2,
    WEDNESDAY: 3,
    THURSDAY: 4,
    FRIDAY: 5,
    SATURDAY: 6,
  }[day] ?? 0;
}

function nextWeeklyRunAfter(now: Date, day: string, time: string): Date | null {
  const parsed = parseTime(time);
  if (!parsed || !ENUM_CONFIG_OPTIONS['booking.allocationRunDay'].some((o) => o.value === day)) return null;
  const [hh, mm] = parsed;
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const deltaDays = (runDayIndex(day) - ist.getUTCDay() + 7) % 7;
  const candidate = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + deltaDays, hh, mm);
  return new Date((candidate <= ist.getTime() ? candidate + 7 * DAY_MS : candidate) - IST_OFFSET_MS);
}

function nextMonthlyRunAfter(now: Date, day: string, time: string): Date | null {
  const parsed = parseTime(time);
  if (!parsed || !ENUM_CONFIG_OPTIONS['booking.allocationRunDay'].some((o) => o.value === day)) return null;
  const [hh, mm] = parsed;
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  for (let monthOffset = 0; monthOffset < 24; monthOffset += 1) {
    const monthStart = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + monthOffset, 1, hh, mm);
    const first = new Date(monthStart);
    const candidate = monthStart + ((runDayIndex(day) - first.getUTCDay() + 7) % 7) * DAY_MS;
    if (candidate > ist.getTime()) return new Date(candidate - IST_OFFSET_MS);
  }
  return null;
}

function nextBiweeklyRunAfter(now: Date, day: string, time: string): Date | null {
  const parsed = parseTime(time);
  const first = nextWeeklyRunAfter(new Date('2026-08-09T14:29:59.999Z'), day, time);
  if (!parsed || !first) return null;
  const [hh, mm] = parsed;
  let run = first;
  while (run.getTime() <= now.getTime()) run = new Date(run.getTime() + 14 * DAY_MS);
  const istRun = new Date(run.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(istRun.getUTCFullYear(), istRun.getUTCMonth(), istRun.getUTCDate(), hh, mm) - IST_OFFSET_MS);
}

function nextRuns(values: Record<string, string>, count = 5): Date[] {
  const frequency = values['booking.allocationRunFrequency'] ?? 'WEEKLY';
  const day = values['booking.allocationRunDay'] ?? 'SUNDAY';
  const time = values['booking.allocationRunTime'] ?? '20:00';
  const runs: Date[] = [];
  let cursor = new Date();
  for (let i = 0; i < count; i += 1) {
    let next: Date | null = null;
    if (frequency === 'WEEKLY') next = nextWeeklyRunAfter(cursor, day, time);
    if (frequency === 'BIWEEKLY') next = nextBiweeklyRunAfter(cursor, day, time);
    if (frequency === 'MONTHLY') next = nextMonthlyRunAfter(cursor, day, time);
    if (!next) return runs;
    runs.push(next);
    cursor = next;
  }
  return runs;
}

function formatRun(d: Date) {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  }).format(d);
}

export function ConfigTimings() {
  const config = useConfig();
  const update = useUpdateConfig();
  const { toast } = useToast();

  const entries = useMemo(() => {
    const rows = [...(config.data ?? [])];
    for (const fallback of DEFAULT_RUN_ENTRIES) {
      if (!rows.some((e) => e.key === fallback.key)) rows.push(fallback);
    }
    return rows;
  }, [config.data]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Seed the editable draft from the server on first load, and re-seed on later
  // (re)loads ONLY when the user has no unsaved edits — so a background refetch
  // (e.g. window refocus) can't silently wipe in-progress changes.
  useEffect(() => {
    const current = draftRef.current;
    const dirty = entries.some((e) => current[e.key] !== undefined && current[e.key] !== e.value);
    if (dirty) return;
    setDraft(Object.fromEntries(entries.map((e) => [e.key, e.value])));
    setErrors({});
  }, [entries]);

  function computeErrors(next: Record<string, string>): Record<string, string> {
    const errs: Record<string, string> = {};
    for (const e of entries) {
      const err = validateConfigValue(e.key, e.valueType, next[e.key] ?? '');
      if (err) errs[e.key] = err;
    }
    // Overlay the cross-field timing order (don't clobber a per-field message).
    for (const [k, m] of Object.entries(validateTimingOrder(next))) {
      if (!errs[k]) errs[k] = m;
    }
    return errs;
  }

  function setField(key: string, value: string) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    setErrors(computeErrors(next));
  }

  const dirty = entries.some((e) => draft[e.key] !== e.value);
  const hasErrors = Object.keys(errors).length > 0;

  function onSave() {
    const errs = computeErrors(draft);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const patch: Record<string, string> = {};
    for (const e of entries) if (draft[e.key] !== e.value) patch[e.key] = draft[e.key];
    if (Object.keys(patch).length === 0) return;

    update.mutate(patch, {
      onSuccess: () => toast('Configuration saved.', { tone: 'success' }),
      onError: (err) => {
        if (err instanceof ApiError && err.details?.length) {
          const fieldErrors = Object.fromEntries(err.details.map((d) => [d.field, d.message]));
          setErrors((prev) => ({ ...prev, ...fieldErrors }));
        }
        toast(err instanceof ApiError ? err.message : 'Could not save configuration.', { tone: 'danger' });
      },
    });
  }

  if (config.isLoading) return <LoadingState label="Loading configuration…" />;
  if (config.isError) return <ErrorState title="Couldn't load configuration" />;

  const runEntries = RUN_KEYS.map((key) => entries.find((e) => e.key === key)).filter((e): e is ConfigEntry => Boolean(e));
  const numbers = entries.filter((e) => e.valueType === 'NUMBER');
  const others = entries.filter((e) => e.valueType !== 'TIME' && e.valueType !== 'NUMBER' && !RUN_KEYS.includes(e.key));
  const previewRuns = nextRuns(draft);

  function renderField(e: ConfigEntry) {
    const value = draft[e.key] ?? '';
    const common = {
      label: e.description || labelForKey(e.key),
      error: errors[e.key],
    };
    if (ENUM_CONFIG_OPTIONS[e.key]) {
      return (
        <Select
          key={e.key}
          {...common}
          options={ENUM_CONFIG_OPTIONS[e.key]}
          value={value}
          onChange={(ev) => setField(e.key, ev.target.value)}
        />
      );
    }
    if (e.valueType === 'BOOLEAN') {
      return (
        <Select
          key={e.key}
          {...common}
          options={BOOLEAN_OPTIONS}
          value={value}
          onChange={(ev) => setField(e.key, ev.target.value)}
        />
      );
    }
    return (
      <Input
        key={e.key}
        {...common}
        type={inputType(e.valueType)}
        step={e.valueType === 'NUMBER' ? 'any' : undefined}
        value={value}
        onChange={(ev) => setField(e.key, ev.target.value)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-4xl">System configuration</h1>
        <p className="text-text-muted">Booking windows, scoring weights, and limits. Validated before saving.</p>
      </div>

      {runEntries.length > 0 && (
        <Card title="Automatic allocation run" description="Choose the interval, day, and IST time for automatic allocation.">
          <div className="grid gap-4 sm:grid-cols-3">{runEntries.map(renderField)}</div>
          {previewRuns.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-text">Next 5 runs</h3>
              <ol className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {previewRuns.map((run) => (
                  <li key={run.toISOString()} className="border border-border bg-surface-2 px-3 py-2 text-sm">
                    {formatRun(run)} IST
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Card>
      )}

      {numbers.length > 0 && (
        <Card title="Scoring & limits">
          <div className="grid gap-4 sm:grid-cols-2">{numbers.map(renderField)}</div>
        </Card>
      )}

      {others.length > 0 && (
        <Card title="Other">
          <div className="grid gap-4 sm:grid-cols-2">{others.map(renderField)}</div>
        </Card>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={onSave} loading={update.isPending} disabled={!dirty || hasErrors}>
          Save changes
        </Button>
        {hasErrors && (
          <p role="alert" className="text-sm text-danger">
            Fix the highlighted fields before saving.
          </p>
        )}
      </div>
    </div>
  );
}
