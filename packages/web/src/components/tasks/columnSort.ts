/**
 * columnSort.ts — the kanban's PER-COLUMN order, pure.
 *
 * The board has one order for every column (`BoardArrange`'s picker, `boardPrefs.sort`), and a
 * column title can now override it for THAT column alone. The two layers are deliberately not merged
 * into one: the picker stays the board's default for every column nobody touched, and an override is
 * the smaller, later statement about one status.
 *
 *  - **An override is stored only when it says something the board's own order does not.** Picking
 *    the very order the board already uses is the same as picking nothing, so it is dropped — the
 *    stored record never accumulates columns that merely repeat the default, and a later change of the
 *    board's order still reaches them.
 *  - **The cycle is `nextSort`'s** (none → ascending → descending → the board's own order), read
 *    against the order the column is showing NOW, so a column following a descending cost order and
 *    asked for cost again moves on instead of appearing to do nothing.
 *  - **The way back ends at HAND ORDER, not at "follow the board".** `nextSort` says "back to the
 *    board's own order", and on this board that order IS the `manual` key. A column whose third click
 *    fell through to a non-manual board order would be a column with no way to arrange by hand.
 */

import { canReorderBy, DEFAULT_SORT, nextSort, type SortSpec } from '@agentistics/core'

/** A column's own order, keyed by status id. A status absent from the record follows the board. */
export type ColumnSorts = Record<string, SortSpec>

export const sameSort = (a: SortSpec, b: SortSpec): boolean => a.key === b.key && a.dir === b.dir

/** The order a column is actually drawn in: its override, else the board's. */
export function effectiveSort(board: SortSpec, columns: ColumnSorts, status: string): SortSpec {
  return columns[status] ?? board
}

/** Has this column been given an order of its own? */
export function hasOverride(columns: ColumnSorts, status: string): boolean {
  return columns[status] !== undefined
}

/**
 * A pick in one column's sort menu: the new record of overrides.
 *
 * Never mutates. The result drops the column's entry when the new order equals the board's.
 */
export function pickColumnSort(
  board: SortSpec, columns: ColumnSorts, status: string, key: SortSpec['key'],
): ColumnSorts {
  const current = effectiveSort(board, columns, status)
  // Hand order has no direction to cycle through: it is a place, not a ranking, and a "descending"
  // hand order is one a drop cannot express (`canReorderBy`). Asking for it sets it, and asking for
  // it again while it is in force is the same as asking for nothing.
  const next = key === 'manual'
    ? (canReorderBy(current) ? current : DEFAULT_SORT)
    : nextSort(current, key)
  return withColumnSort(board, columns, status, next)
}

/** Set (or, when it equals the board's order, drop) one column's override. */
export function withColumnSort(
  board: SortSpec, columns: ColumnSorts, status: string, spec: SortSpec,
): ColumnSorts {
  const rest = { ...columns }
  delete rest[status]
  return sameSort(spec, board) ? rest : { ...rest, [status]: spec }
}

/** Forget one column's override — it follows the board's order again. */
export function clearColumnSort(columns: ColumnSorts, status: string): ColumnSorts {
  if (columns[status] === undefined) return columns
  const rest = { ...columns }
  delete rest[status]
  return rest
}
