/**
 * What this file can assert without a pointer or a portal: `treeMenuEntries`, the one piece of
 * logic in `TreeContextMenu.tsx` that decides anything. This repo has no jsdom/`@testing-library`
 * (see `ConnectionCard.test.tsx`'s own note), so a click on the rendered menu cannot be simulated —
 * which is exactly why that decision is its own exported, pure function.
 */
import { describe, expect, test } from 'bun:test'
import { treeMenuEntries } from './TreeContextMenu'

describe('treeMenuEntries', () => {
  test('a file offers create/rename/move/copy/delete, in this order, with no mention and no copy-path by default', () => {
    const actions = treeMenuEntries('file', 'en', false, false).map(e => e.action)
    expect(actions).toEqual([
      'new-file', 'new-folder', 'rename', 'move', 'copy-relative-path', 'delete',
    ])
  })

  test('a folder says "Delete folder", naming what is about to go', () => {
    const entry = treeMenuEntries('dir', 'en', false, false).find(e => e.action === 'delete')!
    expect(entry.label).toBe('Delete folder')
  })

  test('a file says plain "Delete"', () => {
    const entry = treeMenuEntries('file', 'en', false, false).find(e => e.action === 'delete')!
    expect(entry.label).toBe('Delete')
  })

  test('mention is ABSENT by default — never a disabled row with no explanation', () => {
    const actions = treeMenuEntries('file', 'en', false, false).map(e => e.action)
    expect(actions).not.toContain('mention')
  })

  test('mention appears, second to last, when the caller supplies a handler', () => {
    const actions = treeMenuEntries('file', 'en', true, false).map(e => e.action)
    expect(actions.at(-2)).toBe('mention')
    expect(actions.at(-1)).toBe('delete')
  })

  test('copy-path is ABSENT by default and appears when the caller supplies it', () => {
    expect(treeMenuEntries('file', 'en', false, false).map(e => e.action)).not.toContain('copy-path')
    const withIt = treeMenuEntries('file', 'en', false, true).map(e => e.action)
    expect(withIt).toContain('copy-path')
    // Right after its sibling copy action.
    expect(withIt.indexOf('copy-path')).toBe(withIt.indexOf('copy-relative-path') + 1)
  })

  test('both optional rows together land between the copy actions and delete', () => {
    const actions = treeMenuEntries('file', 'en', true, true).map(e => e.action)
    expect(actions).toEqual([
      'new-file', 'new-folder', 'rename', 'move', 'copy-relative-path', 'copy-path', 'mention', 'delete',
    ])
  })

  test('every entry is worded in Portuguese too, and the two languages disagree on every label', () => {
    const en = treeMenuEntries('dir', 'en', true, true)
    const pt = treeMenuEntries('dir', 'pt', true, true)
    expect(en.length).toBe(pt.length)
    for (let i = 0; i < en.length; i++) {
      expect(en[i]!.action).toBe(pt[i]!.action)
      expect(en[i]!.label).not.toBe(pt[i]!.label)
    }
  })
})
