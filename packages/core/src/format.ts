export function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function fmtDuration(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function fmtCost(usd: number, currency: 'USD' | 'BRL' = 'USD', rate = 1): string {
  if (currency === 'BRL') {
    const brl = usd * rate
    if (brl < 0.05) return '<R$0,05'
    const [intPart, decPart] = brl.toFixed(2).split('.')
    return `R$${(intPart ?? '0').replace(/\B(?=(\d{3})+$)/g, '.')},${decPart}`
  }
  if (usd < 0.01) return '<USD 0.01'
  return `USD ${usd.toFixed(2)}`
}

/**
 * Human-readable label for a session: its title if set, otherwise the first prompt with
 * Claude's local-command/command wrappers stripped (those show up as noisy
 * `<local-command-caveat>…` blocks that make untitled sessions look broken). Returns '' when
 * there's nothing usable, so callers can supply their own localized placeholder.
 */
export function sessionLabel(s: { title?: string; first_prompt?: string }): string {
  const title = (s.title ?? '').trim()
  if (title) return title
  const fp = (s.first_prompt ?? '').trim()
  const cleaned = fp
    .replace(/<local-command-[a-z]*>[\s\S]*?<\/local-command-[a-z]*>/gi, ' ')
    .replace(/<command-[a-z]+>[\s\S]*?<\/command-[a-z]+>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || ''
}

export function fmtFull(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

export function fmtCostFull(usd: number, currency: 'USD' | 'BRL' = 'USD', rate = 1): string {
  if (currency === 'BRL') {
    const brl = usd * rate
    if (brl < 0.00001) return '<R$0,00001'
    const [intPart, decPart] = brl.toFixed(6).split('.')
    return `R$${(intPart ?? '0').replace(/\B(?=(\d{3})+$)/g, '.')},${decPart}`
  }
  if (usd < 0.000001) return '<USD 0.000001'
  return `USD ${usd.toFixed(6)}`
}
