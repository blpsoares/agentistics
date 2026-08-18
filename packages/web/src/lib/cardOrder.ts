/**
 * cardOrder.ts — PURE. Which KPI cards the home row shows, and in what order.
 *
 * The order is user-configurable and PERSISTED (`localStorage`), which makes the card id set a
 * stored contract rather than an implementation detail: any id that stops existing is still in
 * somebody's saved order tomorrow. This module owns the reconciliation, so a rename has exactly one
 * place to be handled and a test to prove it.
 *
 * The case that produced it: `input-tokens` and `output-tokens` were two cards showing two of the
 * four billed counters — measured on a real machine, 0,34 % of the volume, with the cache (the
 * other 99,66 %) on no KPI row at all. They are replaced by ONE `tokens` card carrying the total
 * plus all four counters. A user who had reordered their row would otherwise open the dashboard to
 * a token card missing entirely, because `mergeCardOrder` only ever kept ids it recognised.
 */

export type CardId =
  | 'messages' | 'sessions' | 'tool-calls' | 'tokens' | 'cost'
  | 'streak' | 'longest-session' | 'commits' | 'files'

export const DEFAULT_CARD_ORDER: CardId[] = [
  'messages', 'sessions', 'tool-calls', 'tokens',
  'cost', 'streak', 'longest-session', 'commits', 'files',
]

/**
 * Ids this row used to have, and what each becomes.
 *
 * Both legacy token cards collapse onto the same replacement, so a saved order holding the pair
 * yields ONE card — at the position of whichever came first, because that is where the user put
 * their tokens.
 */
const RENAMED: Record<string, CardId> = {
  'input-tokens': 'tokens',
  'output-tokens': 'tokens',
}

/**
 * Reconcile a saved order with the current card set.
 *
 * - a renamed id becomes its replacement, at its own position
 * - duplicates (the two token cards collapsing) keep the FIRST occurrence
 * - unknown ids are dropped — a card that no longer exists cannot be rendered
 * - cards missing from the saved order are inserted at their DEFAULT position, so a new card
 *   appears where it was designed to sit rather than tacked onto the end
 */
export function migrateCardOrder(saved: readonly string[]): CardId[] {
  const seen = new Set<CardId>()
  const merged: CardId[] = []
  for (const raw of saved) {
    const id = (RENAMED[raw] ?? raw) as CardId
    if (!DEFAULT_CARD_ORDER.includes(id) || seen.has(id)) continue
    seen.add(id)
    merged.push(id)
  }
  for (let i = 0; i < DEFAULT_CARD_ORDER.length; i++) {
    const id = DEFAULT_CARD_ORDER[i]!
    if (seen.has(id)) continue
    // Insert after the nearest preceding default card that IS present, so the new card lands in
    // its designed neighbourhood instead of at the end of a customized row.
    let insertPos = merged.length
    for (let j = i - 1; j >= 0; j--) {
      const predIdx = merged.indexOf(DEFAULT_CARD_ORDER[j]!)
      if (predIdx >= 0) { insertPos = predIdx + 1; break }
    }
    seen.add(id)
    merged.splice(insertPos, 0, id)
  }
  return merged
}
