export const MIN_CENTS = 50;
export const MAX_CENTS = 1_000_000;

/** "$1,234.5" -> 123450 cents; null for blank; NaN for invalid. */
export function toCents(raw: string): number | null {
  const v = raw.trim().replace(/[$,\s]/g, '');
  if (v === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return NaN;
  const [d, f = ''] = v.split('.');
  return Number(d) * 100 + Number(f.padEnd(2, '0'));
}

export function inRange(cents: number): boolean {
  return Number.isInteger(cents) && cents >= MIN_CENTS && cents <= MAX_CENTS;
}
