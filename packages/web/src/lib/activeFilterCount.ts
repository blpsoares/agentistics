/**
 * activeFilterCount.ts — PURE mirror of `FiltersBar`'s own dimension count.
 *
 * `FiltersBar` computes, internally, how many filter DIMENSIONS are currently narrowing what is on
 * screen — the number its own "+ Filtro" and "Ver filtros ativos" badges show. The Sessions
 * workspace's Filtros tab needs that same number for the badge on its OWN collapsed trigger, before
 * the panel holding `FiltersBar` is ever open — so it cannot simply read the number off the
 * component, and re-deriving a DIFFERENT count would put two disagreeing badges a few pixels apart
 * on the same screen.
 *
 * This is therefore a byte-for-byte mirror of `FiltersBar`'s own list (see its `activeFilterCount`,
 * next to `clearAllFilters` — the two are kept side by side there so a dimension added to one is
 * answered by the other). If that list changes, this one has to change with it; there is no shared
 * import between them because `FiltersBar` computes the count from state that only exists once the
 * bar has mounted (`hasRepoFilter`/`hasTagFilter`/etc., which are themselves plain reads of
 * `filters.repos`/`filters.tags`/… and cost nothing to duplicate here).
 *
 * `dateRange` / `customStart` / `customEnd` are deliberately NOT dimensions here: the date presets
 * sit outside the "+ Filtro" menu and are always visible, so `FiltersBar` never counts them either.
 */
import type { Filters } from '@agentistics/core'

/**
 * `activeOnly` is passed as a plain boolean rather than re-deriving `FiltersBar`'s
 * `Boolean(onActiveOnlyChange && activeOnly)` guard: every caller of this helper always wires the
 * switch through, so the callback is never the missing half.
 */
export function countActiveFilters(filters: Filters, activeOnly: boolean): number {
  return [
    (filters.users?.length ?? 0) > 0,
    (filters.harnesses?.length ?? 0) > 0,
    filters.presence !== undefined,
    (filters.repos?.length ?? 0) > 0,
    (filters.tags?.length ?? 0) > 0,
    filters.projects.length > 0,
    (filters.models?.length ?? 0) > 0,
    (filters.teams?.length ?? 0) > 0,
    (filters.machines?.length ?? 0) > 0,
    activeOnly,
  ].filter(Boolean).length
}
