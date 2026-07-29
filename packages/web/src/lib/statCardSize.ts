/**
 * Headline font size for a KPI value, scaled so the number stays readable as it grows.
 *
 * The size is measured on the NUMBER ONLY — any leading currency prefix is stripped first.
 * Measuring the whole string made the same amount render two steps smaller in English than in
 * Portuguese: "USD 16,611.61" (13 chars) crossed a threshold that "R$84.362,05" (11) did not,
 * purely because "USD " is two characters longer than "R$".
 *
 * Lives here rather than in StatCard.tsx so its test can import it without dragging React and
 * `lucide-react` into the test module graph — that CJS/ESM interop is what made the suite fail
 * with `react.createContext is not a function`, but only when another file had already loaded
 * React, so it looked like a flake and forced every commit through `--no-verify`.
 */
export function valueFontSize(value: string | number): number {
  const measured = String(value).replace(/^[^\d-]+/, '').trim()
  if (measured.length > 11) return 15
  if (measured.length > 8) return 19
  if (measured.length > 5) return 22
  return 26
}
