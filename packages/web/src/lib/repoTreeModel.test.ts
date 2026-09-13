import { describe, expect, test } from 'bun:test'
import {
  applyChildren, applyError, baseNameOf, canMoveInto, closeTab, destinationPath, flattenVisible,
  isSelfOrDescendant, makeRootNode, markDirty, openTab, parentOf, retargetOpenPaths, retargetPath,
  setLoading, toggleExpanded, type OpenTab, type TreeChild,
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
    expect(openTab([], 'a.ts')).toEqual([{ id: 'a.ts', path: 'a.ts', dirty: false }])
  })
  test('opening an already-open path is a no-op — the caller just activates it', () => {
    const tabs = openTab([], 'a.ts')
    expect(openTab(tabs, 'a.ts')).toEqual(tabs)
  })
  test('closeTab removes exactly the named tab', () => {
    const tabs = openTab(openTab([], 'a.ts'), 'b.ts')
    expect(closeTab(tabs, 'a.ts')).toEqual([{ id: 'b.ts', path: 'b.ts', dirty: false }])
  })
  test('markDirty flips one tab without touching the others', () => {
    const tabs = openTab(openTab([], 'a.ts'), 'b.ts')
    const out = markDirty(tabs, 'a.ts', true)
    expect(out).toEqual([
      { id: 'a.ts', path: 'a.ts', dirty: true },
      { id: 'b.ts', path: 'b.ts', dirty: false },
    ])
  })
  test('a tab keeps the path it was FIRST opened at as its id, across a rename', () => {
    const tabs = openTab([], 'old.ts')
    const renamed = retargetOpenPaths(tabs, 'old.ts', 'new.ts')
    expect(renamed).toEqual([{ id: 'old.ts', path: 'new.ts', dirty: false }])
  })
})

// --- path arithmetic: rename, move, and what it does to an open tab --------------------------------

describe('parentOf', () => {
  test('a nested path loses its last segment', () => {
    expect(parentOf('src/components/Foo.tsx')).toBe('src/components')
  })
  test('a root-level path has the root as its parent', () => {
    expect(parentOf('README.md')).toBe('')
  })
})

describe('baseNameOf', () => {
  test('a nested path keeps only its last segment', () => {
    expect(baseNameOf('src/components/Foo.tsx')).toBe('Foo.tsx')
  })
  test('a root-level path is its own basename', () => {
    expect(baseNameOf('README.md')).toBe('README.md')
  })
})

describe('isSelfOrDescendant', () => {
  test('a path equals its own ancestor', () => {
    expect(isSelfOrDescendant('src', 'src')).toBe(true)
  })
  test('a child is a descendant', () => {
    expect(isSelfOrDescendant('src/a.ts', 'src')).toBe(true)
  })
  test('a sibling whose name merely starts the same is NOT a descendant — the separator matters', () => {
    expect(isSelfOrDescendant('src2/a.ts', 'src')).toBe(false)
  })
  test('an unrelated path is not a descendant', () => {
    expect(isSelfOrDescendant('docs/readme.md', 'src')).toBe(false)
  })
})

describe('destinationPath', () => {
  test('moving into a folder keeps the basename', () => {
    expect(destinationPath('src/a.ts', 'docs')).toBe('docs/a.ts')
  })
  test('moving to the root keeps the basename with no leading segment', () => {
    expect(destinationPath('src/deep/a.ts', '')).toBe('a.ts')
  })
})

describe('canMoveInto — what a drag or the folder picker may actually attempt', () => {
  test('a file may move into any folder that is not where it already is', () => {
    expect(canMoveInto('src/a.ts', 'docs')).toBe(true)
  })
  test('a folder may not move into itself', () => {
    expect(canMoveInto('src', 'src')).toBe(false)
  })
  test('a folder may not move into its own descendant', () => {
    expect(canMoveInto('src', 'src/deep')).toBe(false)
  })
  test('moving into the parent it is already in is refused as a no-op', () => {
    expect(canMoveInto('src/a.ts', 'src')).toBe(false)
  })
  test('moving a root-level entry to the root it is already at is refused', () => {
    expect(canMoveInto('a.ts', '')).toBe(false)
  })
  test('moving a root-level entry INTO a folder is fine', () => {
    expect(canMoveInto('a.ts', 'src')).toBe(true)
  })
})

describe('retargetPath — where one path lands after from→to', () => {
  test('an exact match retargets', () => {
    expect(retargetPath('a.ts', 'a.ts', 'b.ts')).toBe('b.ts')
  })
  test('a path inside a renamed directory retargets, keeping its own tail', () => {
    expect(retargetPath('src/deep/a.ts', 'src', 'lib')).toBe('lib/deep/a.ts')
  })
  test('an unrelated path is untouched — null, not itself, so a caller can tell "moved" from "same"', () => {
    expect(retargetPath('docs/readme.md', 'src', 'lib')).toBeNull()
  })
  test('a sibling directory whose name merely starts the same is untouched', () => {
    expect(retargetPath('src2/a.ts', 'src', 'lib')).toBeNull()
  })
})

describe('retargetOpenPaths — every open tab, re-keyed the same way', () => {
  test('a renamed FILE retargets only the matching tab', () => {
    const tabs: OpenTab[] = [
      { id: 'a.ts', path: 'a.ts', dirty: true },
      { id: 'b.ts', path: 'b.ts', dirty: false },
    ]
    expect(retargetOpenPaths(tabs, 'a.ts', 'renamed.ts')).toEqual([
      { id: 'a.ts', path: 'renamed.ts', dirty: true },
      { id: 'b.ts', path: 'b.ts', dirty: false },
    ])
  })

  test('moving a DIRECTORY retargets every open file under it, in one pass', () => {
    const tabs: OpenTab[] = [
      { id: 'src/a.ts', path: 'src/a.ts', dirty: true },
      { id: 'src/deep/b.ts', path: 'src/deep/b.ts', dirty: false },
      { id: 'docs/readme.md', path: 'docs/readme.md', dirty: false },
    ]
    expect(retargetOpenPaths(tabs, 'src', 'lib')).toEqual([
      { id: 'src/a.ts', path: 'lib/a.ts', dirty: true },
      { id: 'src/deep/b.ts', path: 'lib/deep/b.ts', dirty: false },
      { id: 'docs/readme.md', path: 'docs/readme.md', dirty: false },
    ])
  })

  test('a tab this rename does not concern comes back the SAME object — no new identity on every unrelated rename', () => {
    const untouched: OpenTab = { id: 'docs/readme.md', path: 'docs/readme.md', dirty: false }
    const [out] = retargetOpenPaths([untouched], 'src', 'lib')
    expect(out).toBe(untouched)
  })

  test('an id stays the path the tab was FIRST opened at, through two renames in a row', () => {
    let tabs: OpenTab[] = [{ id: 'a.ts', path: 'a.ts', dirty: true }]
    tabs = retargetOpenPaths(tabs, 'a.ts', 'b.ts')
    tabs = retargetOpenPaths(tabs, 'b.ts', 'c.ts')
    expect(tabs).toEqual([{ id: 'a.ts', path: 'c.ts', dirty: true }])
  })
})
