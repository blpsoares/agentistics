import { describe, expect, it } from 'bun:test'
import {
  type SessionUserGroupsValue,
  groupOfSession, planAddToGroup, planCreateGroup, planDeleteGroup, planRemoveFromGroup,
  planReorderInGroup, planRenameGroup, resolveGroupRows,
} from './sessionUserGroups'

const empty: SessionUserGroupsValue = { groups: [] }
const withOne: SessionUserGroupsValue = {
  groups: [{ id: 'g1', name: 'Saved to later', sessionKeys: ['a', 'b'] }],
}

describe('planCreateGroup', () => {
  it('creates a group with the trimmed name, empty', () => {
    const { next, id } = planCreateGroup(empty, '  Saved to later  ')
    expect(id).not.toBeNull()
    expect(next.groups).toEqual([{ id: id!, name: 'Saved to later', sessionKeys: [] }])
  })

  it('refuses a blank name (empty or whitespace-only), leaving the value unchanged', () => {
    expect(planCreateGroup(empty, '')).toEqual({ next: empty, id: null })
    expect(planCreateGroup(empty, '   ')).toEqual({ next: empty, id: null })
  })

  it('appends after existing groups', () => {
    const { next } = planCreateGroup(withOne, 'Second')
    expect(next.groups.map(g => g.name)).toEqual(['Saved to later', 'Second'])
  })

  it('allows a duplicate name — groups are addressed by id, never by name', () => {
    const { next, id } = planCreateGroup(withOne, 'Saved to later')
    expect(id).not.toBeNull()
    expect(next.groups.filter(g => g.name === 'Saved to later')).toHaveLength(2)
  })

  it('two creations mint distinct ids', () => {
    const a = planCreateGroup(empty, 'A')
    const b = planCreateGroup(a.next, 'B')
    expect(a.id).not.toBe(b.id)
  })
})

describe('planRenameGroup', () => {
  it('renames, trimmed', () => {
    expect(planRenameGroup(withOne, 'g1', '  Later  ').groups[0]!.name).toBe('Later')
  })

  it('refuses a blank name', () => {
    expect(planRenameGroup(withOne, 'g1', '   ')).toEqual(withOne)
  })

  it('a missing id is a no-op', () => {
    expect(planRenameGroup(withOne, 'ghost', 'X')).toEqual(withOne)
  })

  it('never touches sessionKeys', () => {
    expect(planRenameGroup(withOne, 'g1', 'Later').groups[0]!.sessionKeys).toEqual(['a', 'b'])
  })
})

describe('planDeleteGroup', () => {
  it('removes the group and nothing else', () => {
    const two: SessionUserGroupsValue = {
      groups: [...withOne.groups, { id: 'g2', name: 'Other', sessionKeys: ['c'] }],
    }
    expect(planDeleteGroup(two, 'g1')).toEqual({ groups: [{ id: 'g2', name: 'Other', sessionKeys: ['c'] }] })
  })

  it('a missing id is a no-op', () => {
    expect(planDeleteGroup(withOne, 'ghost')).toEqual(withOne)
  })
})

describe('groupOfSession', () => {
  it('finds the group holding a key', () => {
    expect(groupOfSession(withOne, 'a')?.id).toBe('g1')
  })

  it('is undefined for a key in no group', () => {
    expect(groupOfSession(withOne, 'z')).toBeUndefined()
  })
})

describe('planAddToGroup', () => {
  it('appends a new key to the target group', () => {
    expect(planAddToGroup(withOne, 'g1', 'c').groups[0]!.sessionKeys).toEqual(['a', 'b', 'c'])
  })

  it('MOVES a key already in another group — membership is exclusive', () => {
    const two: SessionUserGroupsValue = {
      groups: [...withOne.groups, { id: 'g2', name: 'Other', sessionKeys: ['c'] }],
    }
    const next = planAddToGroup(two, 'g1', 'c')
    expect(next.groups.find(g => g.id === 'g1')!.sessionKeys).toEqual(['a', 'b', 'c'])
    expect(next.groups.find(g => g.id === 'g2')!.sessionKeys).toEqual([])
  })

  it('dropping a key already in the target group is a no-op (position unchanged)', () => {
    expect(planAddToGroup(withOne, 'g1', 'a')).toEqual(withOne)
  })

  it('an unknown target group id is a no-op', () => {
    expect(planAddToGroup(withOne, 'ghost', 'z')).toEqual(withOne)
  })
})

describe('planRemoveFromGroup', () => {
  it('removes the key from whichever group holds it', () => {
    expect(planRemoveFromGroup(withOne, 'a').groups[0]!.sessionKeys).toEqual(['b'])
  })

  it('a key in no group is a no-op', () => {
    expect(planRemoveFromGroup(withOne, 'z')).toEqual(withOne)
  })
})

describe('planReorderInGroup', () => {
  it('reorders by key within the named group', () => {
    const three: SessionUserGroupsValue = { groups: [{ id: 'g1', name: 'X', sessionKeys: ['a', 'b', 'c'] }] }
    expect(planReorderInGroup(three, 'g1', 'a', 'c').groups[0]!.sessionKeys).toEqual(['b', 'a', 'c'])
  })

  it('never touches a different group', () => {
    const two: SessionUserGroupsValue = {
      groups: [{ id: 'g1', name: 'X', sessionKeys: ['a', 'b'] }, { id: 'g2', name: 'Y', sessionKeys: ['c', 'd'] }],
    }
    const next = planReorderInGroup(two, 'g1', 'a', 'b')
    expect(next.groups.find(g => g.id === 'g2')!.sessionKeys).toEqual(['c', 'd'])
  })
})

interface Row { id: string; state: string }
const keyOf = (r: Row) => r.id

describe('resolveGroupRows', () => {
  it('resolves regardless of state — a group is never filtered by what the session is doing', () => {
    const group = { id: 'g1', name: 'X', sessionKeys: ['a', 'b'] }
    const rows: Row[] = [{ id: 'a', state: 'working' }, { id: 'b', state: 'exited' }]
    expect(resolveGroupRows(group, rows, keyOf)).toEqual(rows)
  })

  it('keeps the group order, not row order', () => {
    const group = { id: 'g1', name: 'X', sessionKeys: ['b', 'a'] }
    const rows: Row[] = [{ id: 'a', state: 'working' }, { id: 'b', state: 'working' }]
    expect(resolveGroupRows(group, rows, keyOf).map(r => r.id)).toEqual(['b', 'a'])
  })

  it('hides an unresolvable key rather than inventing a row, and keeps every resolvable one', () => {
    const group = { id: 'g1', name: 'X', sessionKeys: ['a', 'gone'] }
    const rows: Row[] = [{ id: 'a', state: 'working' }]
    expect(resolveGroupRows(group, rows, keyOf).map(r => r.id)).toEqual(['a'])
  })

  it('is empty for an empty group or no rows', () => {
    expect(resolveGroupRows({ id: 'g1', name: 'X', sessionKeys: [] }, [{ id: 'a', state: 'working' }], keyOf)).toEqual([])
    expect(resolveGroupRows({ id: 'g1', name: 'X', sessionKeys: ['a'] }, [], keyOf)).toEqual([])
  })
})
