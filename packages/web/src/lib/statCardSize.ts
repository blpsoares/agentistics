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

/**
 * The longer of two renderings of the SAME quantity — used as the sizing basis of a card whose
 * value can be re-rendered in place (the cost card's USD/BRL toggle).
 *
 * Stripping the prefix is not enough there: BRL is ~5× USD, so one amount can legitimately carry
 * an extra digit ("9,819.26" → "53.001,64") and cross a bucket, resizing the headline on every
 * toggle. Sizing both currencies by the wider string keeps the number still while its value
 * changes — the card must not twitch just because you asked the same figure in another currency.
 */
export function widerValue(a: string, b: string): string {
  const len = (s: string) => s.replace(/^[^\d-]+/, '').trim().length
  return len(b) > len(a) ? b : a
}
