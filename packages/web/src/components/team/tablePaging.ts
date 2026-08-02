/**
 * tablePaging.ts — the arithmetic behind the hidden-restrictions table's two sizes.
 *
 * Pure and separate because this is exactly where the bugs of this class live: a page index left
 * pointing past the end after rows disappeared (a rule lifted, a sibling retracting a fact), a
 * page size carried from the maximized view back into the inline preview where it is not offered,
 * an off-by-one on the last page. None of those are visible in a component that renders "0 rows"
 * and looks fine.
 *
 * The rule everywhere: CLAMP, never trust. The caller may hand over any page and any size — a
 * remembered one, a stale one, one from the other mode — and gets back a valid window.
 */

/** Where the table is being shown. The mode owns which sizes are offered, not the caller. */
export type PagingMode = 'inline' | 'maximized'

/**
 * Page sizes per mode.
 *
 * The inline preview lives inside a connection card that must still hold at 390px, so it starts at
 * 5 and stops at 15 — anything bigger belongs in the maximized view, which is the whole reason
 * that view exists. Maximized has room and goes to 50; it is bounded too, because "show
 * everything" on a machine with hundreds of rules is a scroll, not a table.
 */
export const PAGE_SIZE_OPTIONS: Record<PagingMode, readonly number[]> = {
  inline: [5, 10, 15],
  maximized: [10, 25, 50],
}

export interface Paging {
  /** The size actually in use — always one of this mode's options. */
  size: number
  /** The page actually shown, 0-based and always within range. */
  page: number
  /** At least 1: an empty table is on page 1 of 1, never page 1 of 0. */
  pageCount: number
  /** Slice bounds for `rows.slice(start, end)`. */
  start: number
  end: number
  /** The sizes this mode offers, for the size control. */
  sizes: readonly number[]
  /** True when the table has more rows than one page — i.e. the pager is worth rendering. */
  paged: boolean
}

/**
 * Resolve a requested page/size against the rows that actually exist.
 *
 * `size` is snapped to the mode's options rather than rejected: switching from maximized (50) back
 * to inline must not leave the preview trying to render 50 rows inside a card, and a remembered
 * size from an older build must not render zero. The nearest OFFERED size at or below the request
 * wins, falling back to the smallest — so a too-large request narrows, never widens.
 */
export function resolvePaging(input: {
  mode: PagingMode
  total: number
  page: number
  size: number
}): Paging {
  const sizes = PAGE_SIZE_OPTIONS[input.mode]
  const size = snapSize(input.size, sizes)
  const total = Math.max(0, Math.floor(input.total))
  // Never 0: "page 1 of 0" is not a thing a user can read, and it makes every downstream
  // `page + 1 <= pageCount` comparison wrong.
  const pageCount = Math.max(1, Math.ceil(total / size))
  const page = clamp(Math.floor(input.page), 0, pageCount - 1)
  const start = page * size
  return {
    size,
    page,
    pageCount,
    start,
    // `Math.min` and not `start + size`: the last page is short, and slicing past the end would be
    // harmless for an array but wrong for anything that renders `end` as a count.
    end: Math.min(total, start + size),
    sizes,
    paged: total > size,
  }
}

function snapSize(requested: number, sizes: readonly number[]): number {
  const allowed = [...sizes].sort((a, b) => a - b)
  const smallest = allowed[0]!
  if (!Number.isFinite(requested) || requested <= 0) return smallest
  let best = smallest
  for (const s of allowed) if (s <= requested) best = s
  return best
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}

/**
 * How many machine names a cell shows, and how many it had to hold back.
 *
 * The "hidden on" cell is the one that breaks a table: a row restricted on five machines would
 * either blow the column or, worse, silently render the first two and look like the whole truth.
 * A cell that says "+3" is honest about being partial; one that quietly drops names is not — which
 * is the same rule the reverse-warning follows about announcing what it does not know.
 */
export function machineCell(names: readonly string[], max: number): { shown: string[]; extra: number } {
  const limit = Math.max(1, Math.floor(max))
  if (names.length <= limit) return { shown: [...names], extra: 0 }
  // One slot is spent on the "+N" itself, so the count it reports stays truthful.
  const shown = names.slice(0, limit)
  return { shown, extra: names.length - shown.length }
}
