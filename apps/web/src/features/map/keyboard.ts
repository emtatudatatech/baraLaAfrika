/*
 * Roving focus over the map's countries: one Tab stop, arrow keys move through countries in
 * alphabetical order (wrapping), Home/End jump to the first/last.
 */
export function nextCountry(order: readonly string[], current: string, key: string): string | null {
  const index = order.indexOf(current);
  if (index < 0 || order.length === 0) return order[0] ?? null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return order[(index + 1) % order.length] ?? null;
    case 'ArrowLeft':
    case 'ArrowUp':
      return order[(index - 1 + order.length) % order.length] ?? null;
    case 'Home':
      return order[0] ?? null;
    case 'End':
      return order[order.length - 1] ?? null;
    default:
      return null;
  }
}
