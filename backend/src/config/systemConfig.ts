import { prisma } from '../lib/prisma';

/**
 * Cached SystemConfiguration accessor (D8). All booking/allocation timings and weights are read
 * through here at runtime (never hardcoded). Cache is invalidated on PATCH /config so scheduler/
 * allocation always see current values.
 */
interface CachedEntry {
  value: string;
  valueType: string;
}

let cache: Map<string, CachedEntry> | null = null;

export async function loadConfig(): Promise<Map<string, CachedEntry>> {
  const rows = await prisma.systemConfiguration.findMany();
  cache = new Map(rows.map((r) => [r.key, { value: r.value, valueType: r.valueType }]));
  return cache;
}

export async function getConfigCache(): Promise<Map<string, CachedEntry>> {
  if (!cache) await loadConfig();
  return cache as Map<string, CachedEntry>;
}

export function invalidateConfig(): void {
  cache = null;
}

export async function getString(key: string, fallback?: string): Promise<string | undefined> {
  const c = await getConfigCache();
  return c.get(key)?.value ?? fallback;
}

export async function getNumber(key: string, fallback?: number): Promise<number | undefined> {
  const v = await getString(key);
  return v !== undefined ? Number(v) : fallback;
}

export async function getBoolean(key: string, fallback?: boolean): Promise<boolean | undefined> {
  const v = await getString(key);
  return v !== undefined ? v === 'true' : fallback;
}
