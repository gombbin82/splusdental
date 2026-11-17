/** "Visa •••• 4242", or "—" when unknown. */
export function cardLabel(card: { brand: string | null; last4: string | null } | null): string {
  if (!card?.last4) return '—';
  const brand = card.brand ? card.brand[0]!.toUpperCase() + card.brand.slice(1) : 'Card';
  return `${brand} •••• ${card.last4}`;
}

/** True when a hold's capture deadline (unix seconds) is less than 48 hours away. */
export function deadlineSoon(captureBefore: number, nowMs: number): boolean {
  return captureBefore * 1000 - nowMs < 48 * 3600 * 1000;
}
