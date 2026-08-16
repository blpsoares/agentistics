import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { Lang } from '@agentistics/core'

/**
 * dateFormat.ts — the one shared date-display helper for the web app. Pulled out of
 * `ComparePage.tsx` (which had it as a private function) so other callers — e.g. the repo-sharing
 * panel's attribution boundary — reuse the same implementation instead of a second one. "Use the
 * existing helper" (Plan 4 Task 1, fix 3) means THIS function, not a new date formatter.
 *
 * Formats a raw date string (ISO or `yyyy-MM-dd`), localized by language. Returns '—' for missing
 * or unparsable input — never the raw machine-format string, and never a thrown exception.
 */
export function fmtDateLocalized(raw: string | null | undefined, lang: Lang): string {
  if (!raw) return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return '—'
  return lang === 'pt'
    ? format(d, 'dd MMM yyyy', { locale: ptBR })
    : format(d, 'MMM d, yyyy')
}
