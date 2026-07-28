/**
 * statCardSize.ts — valueFontSize, extracted from StatCard.
 *
 * Lives in lib/ rather than beside the component because it is a pure function with its own
 * unit test: importing it from a .tsx dragged lucide-react's CJS bundle into the test process,
 * which fails to resolve React in a clean environment (green locally, red in CI).
 */

/**
 * Font size for a KPI value, chosen by the length of the NUMBER — the currency prefix is
 * stripped first, so "USD 16,611.61" and "R$16.611,61" render at the same size.
 */
export function valueFontSize(value: string | number): number {
  const measured = String(value).replace(/^[^\d-]+/, '').trim()
  if (measured.length > 11) return 15
  if (measured.length > 8) return 19
  if (measured.length > 5) return 22
  return 26
}
