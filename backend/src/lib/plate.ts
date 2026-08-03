/**
 * Canonical vehicle-plate form: uppercase, with everything that is not a letter or digit stripped.
 *
 * "MH 12 AB-1234", "mh12ab1234" and "MH-12-AB-1234" are the same car, and neither the guard typing at
 * the barrier nor whoever formatted the Excel sheet should have to care which form was used. Lives in
 * `lib` (not in the gate service or the importer) so the write path and the read path physically
 * cannot drift — a mismatch there would silently make imported cars unfindable at the gate.
 */
export function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
