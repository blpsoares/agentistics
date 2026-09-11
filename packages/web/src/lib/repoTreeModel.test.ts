import { describe, expect, test } from 'bun:test'
import {
  applyChildren, applyError, closeTab, flattenVisible, makeRootNode, markDirty, openTab,
  setLoading, toggleExpanded, type TreeChild,
} from './repoTreeModel'

describe('the tree model', () => {
  test('a fresh root has no children and nothing visible', () => {
    expect(flattenVisible(makeRootNode())).toEqual([])
  })

  test('applying children at the root makes them visible, in the order given', () => {
    const kids: TreeChild[] = [{ name: 'src', kind: 'dir' }, { name: 'a.ts', kind: 'file' }]
    const root = applyChildren(makeRootNode(), '', kids)
    expect(flattenVisible(root)).toEqual([
      { path: 'src', name: 'src', kind: 'dir', depth: 0, expanded: false, loading: false },
      { path: 'a.ts', name: 'a.ts', kind: 'file', depth: 0, expanded: false, loading: false },
    ])
  })

  test('an unexpanded directory shows no children even after they are loaded', () => {
    let root = applyChildren(makeRootNode(), '', [{ name: 'src', kind: 'dir' }])
    root = applyChildren(root, 'src', [{ name: 'a.ts', kind: 'file' }])
    expect(flattenVisible(root).map(r => r.path)).toEqual(['src'])
  })

  test('expanding a directory reveals its already-loaded children, nested one level deeper', () => {
    let root = applyChildren(makeRootNode(), '', [{ name: 'src', kind: 'dir' }])
    root = applyChildren(root, 'src', [{ name: 'a.ts', kind: 'file' }])
    root = toggleExpanded(root, 'src')
    expect(flattenVisible(root)).toEqual([
      { path: 'src', name: 'src', kind: 'dir', depth: 0, expanded: true, loading: false },
      { path: 'src/a.ts', name: 'a.ts', kind: 'file', depth: 1, expanded: false, loading: false },
    ])
  })

  test('collapsing does not throw away the cached children — re-expanding needs no fetch', () => {
    let root = applyChildren(makeRootNode(), '', [{ name: 'src', kind: 'dir' }])
    root = applyChildren(root, 'src', [{ name: 'a.ts', kind: 'file' }])
    root = toggleExpanded(root, 'src') // open
    root = toggleExpanded(root, 'src') // close
    root = toggleExpanded(root, 'src') // open again — no applyChildren call between these
    expect(flattenVisible(root).map(r => r.path)).toEqual(['src', 'src/a.ts'])
  })

  test('setLoading marks one node without disturbing its siblings', () => {
    let root = applyChildren(makeRootNode(), '', [{ name: 'src', kind: 'dir' }, { name: 'b.ts', kind: 'file' }])
    root = setLoading(root, 'src', true)
    const rows = flattenVisible(root)
    expect(rows.find(r => r.path === 'src')?.loading).toBe(true)
    expect(rows.find(r => r.path === 'b.ts')?.loading).toBe(false)
  })

  test('applyError records a message on the node and clears loading', () => {
    let root = applyChildren(makeRootNode(), '', [{ name: 'src', kind: 'dir' }])
    root = setLoading(root, 'src', true)
    root = applyError(root, 'src', 'refused')
    const row = flattenVisible(root).find(r => r.path === 'src')!
    expect(row.loading).toBe(false)
    expect(row.error).toBe('refused')
  })

  test('a nested path is built by joining segments with "/"', () => {
    let root = applyChildren(makeRootNode(), '', [{ name: 'src', kind: 'dir' }])
    root = toggleExpanded(root, 'src')
    root = applyChildren(root, 'src', [{ name: 'deep', kind: 'dir' }])
    root = toggleExpanded(root, 'src/deep')
    root = applyChildren(root, 'src/deep', [{ name: 'x.ts', kind: 'file' }])
    expect(flattenVisible(root).map(r => r.path)).toEqual(['src', 'src/deep', 'src/deep/x.ts'])
  })
})

describe('the open-tabs model', () => {
  test('opening a new path appends it', () => {
    expect(openTab([], 'a.ts')).toEqual([{ path: 'a.ts', dirty: false }])
  })
  test('opening an already-open path is a no-op — the caller just activates it', () => {
    const tabs = openTab([], 'a.ts')
    expect(openTab(tabs, 'a.ts')).toEqual(tabs)
  })
  test('closeTab removes exactly the named tab', () => {
    const tabs = openTab(openTab([], 'a.ts'), 'b.ts')
    expect(closeTab(tabs, 'a.ts')).toEqual([{ path: 'b.ts', dirty: false }])
  })
  test('markDirty flips one tab without touching the others', () => {
    const tabs = openTab(openTab([], 'a.ts'), 'b.ts')
    const out = markDirty(tabs, 'a.ts', true)
    expect(out).toEqual([{ path: 'a.ts', dirty: true }, { path: 'b.ts', dirty: false }])
  })
})
