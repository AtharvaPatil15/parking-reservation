import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, ErrorState, Input, LoadingState, Select, useToast } from '../../components';
import { useConfig, useUpdateConfig } from '../../api/hooks';
import { ApiError } from '../../api/http';
import type { components } from '../../api/types';
import { labelForKey, validateConfigValue, validateTimingOrder } from './configValidation';

type ConfigEntry = components['schemas']['ConfigEntry'];

const BOOLEAN_OPTIONS = [
  { value: 'true', label: 'true' },
  { value: 'false', label: 'false' },
];

function inputType(valueType: string): string {
  if (valueType === 'TIME') return 'time';
  if (valueType === 'NUMBER') return 'number';
  return 'text';
}

export function ConfigTimings() {
  const config = useConfig();
  const update = useUpdateConfig();
  const { toast } = useToast();

  const entries = useMemo(() => config.data ?? [], [config.data]);
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

  const times = entries.filter((e) => e.valueType === 'TIME');
  const numbers = entries.filter((e) => e.valueType === 'NUMBER');
  const others = entries.filter((e) => e.valueType !== 'TIME' && e.valueType !== 'NUMBER');

  function renderField(e: ConfigEntry) {
    const value = draft[e.key] ?? '';
    const common = {
      label: e.description || labelForKey(e.key),
      hint: errors[e.key] ? undefined : e.key,
      error: errors[e.key],
    };
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
        <h2 className="text-xl font-semibold tracking-tight">System configuration</h2>
        <p className="text-text-muted">Booking windows, scoring weights, and limits. Validated before saving.</p>
      </div>

      {times.length > 0 && (
        <Card title="Booking windows" description="Times must stay in order across the day.">
          <div className="grid gap-4 sm:grid-cols-2">{times.map(renderField)}</div>
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
