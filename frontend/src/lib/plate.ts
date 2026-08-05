/**
 * Client-side mirror of the backend's `normalizePlate` (backend/src/lib/plate.ts).
 *
 * Kept deliberately identical: the gate compares the typed number against `Vehicle.vehicleNumber`,
 * which is stored in this normalized form, so any drift here would make the UI disagree with the
 * server about whether two spellings of a plate are the same car.
 */
export function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
