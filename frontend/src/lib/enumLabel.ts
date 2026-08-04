/**
 * Render a backend enum as words.
 *
 * `COMMON_POOL` and `COMPANY_EVENT` were reaching the screen verbatim — in the
 * employee-facing booking history, no less — while the very same concepts were
 * spelled "Common pool" and "Maintenance" in the dropdowns that produce them. This
 * keeps the wording consistent without renaming anything in the API.
 */
export function enumLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const words = value.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
