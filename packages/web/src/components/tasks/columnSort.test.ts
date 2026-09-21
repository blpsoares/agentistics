import { describe, expect, it } from 'bun:test'
import { DEFAULT_SORT, type SortSpec } from '@agentistics/core'
import {
  clearColumnSort, effectiveSort, hasOverride, pickColumnSort, withColumnSort,
} from './columnSort'

const cost: SortSpec = { key: 'cost', dir: 'asc' }

describe('columnSort', () => {
  it('follows the board until a column is given an order of its own', () => {
    expect(effectiveSort(cost, {}, 'todo')).toEqual(cost)
    expect(effectiveSort(cost, { todo: { key: 'title', dir: 'desc' } }, 'todo')).toEqual({ key: 'title', dir: 'desc' })
    expect(effectiveSort(cost, { todo: { key: 'title', dir: 'desc' } }, 'done')).toEqual(cost)
  })

  it('cycles ascending → descending → hand order on one column, leaving the others alone', () => {
    let cols = pickColumnSort(DEFAULT_SORT, {}, 'todo', 'priority')
    expect(cols).toEqual({ todo: { key: 'priority', dir: 'asc' } })
    cols = pickColumnSort(DEFAULT_SORT, cols, 'todo', 'priority')
    expect(cols).toEqual({ todo: { key: 'priority', dir: 'desc' } })
    // third press: back to hand order — which IS the board's order here, so the override is dropped
    cols = pickColumnSort(DEFAULT_SORT, cols, 'todo', 'priority')
    expect(cols).toEqual({})
    expect(hasOverride(cols, 'todo')).toBe(false)
  })

  it('reads the cycle against what the column shows NOW, so a follower of the board moves on', () => {
    // the board is ordered by cost ascending; asking this column for cost must not look like a no-op
    const cols = pickColumnSort(cost, {}, 'todo', 'cost')
    expect(cols).toEqual({ todo: { key: 'cost', dir: 'desc' } })
  })

  it('ends the cycle on HAND ORDER even when the board is ordered by something else', () => {
    const board: SortSpec = { key: 'cost', dir: 'desc' }
    let cols = pickColumnSort(board, {}, 'todo', 'title')
    cols = pickColumnSort(board, cols, 'todo', 'title') // → title desc
    cols = pickColumnSort(board, cols, 'todo', 'title') // → hand order, kept as an explicit override
    expect(cols).toEqual({ todo: DEFAULT_SORT })
  })

  it('picking hand order sets it, and picking it again while it is in force is a no-op', () => {
    const board: SortSpec = { key: 'cost', dir: 'asc' }
    const once = pickColumnSort(board, {}, 'todo', 'manual')
    expect(once).toEqual({ todo: DEFAULT_SORT })
    expect(pickColumnSort(board, once, 'todo', 'manual')).toEqual(once)
    // …and a board already in hand order needs no override at all
    expect(pickColumnSort(DEFAULT_SORT, {}, 'todo', 'manual')).toEqual({})
  })

  it('drops an override that equals the board order instead of storing a copy of it', () => {
    expect(withColumnSort(cost, { todo: { key: 'title', dir: 'asc' } }, 'todo', cost)).toEqual({})
  })

  it('never mutates the record it was given', () => {
    const before = { todo: { key: 'title', dir: 'asc' } as SortSpec }
    pickColumnSort(DEFAULT_SORT, before, 'done', 'cost')
    clearColumnSort(before, 'todo')
    expect(before).toEqual({ todo: { key: 'title', dir: 'asc' } })
  })

  it('clearing a column that has no override returns the same record', () => {
    const cols = { todo: { key: 'title', dir: 'asc' } as SortSpec }
    expect(clearColumnSort(cols, 'done')).toBe(cols)
    expect(clearColumnSort(cols, 'todo')).toEqual({})
  })
})
