import { describe, expect, test } from 'bun:test'
import { childrenFromDirents, collapseToChildren } from './editor-list'

describe('collapseToChildren', () => {
  test('a flat file at the top is a file child', () => {
    expect(collapseToChildren(['a.ts'])).toEqual([{ name: 'a.ts', kind: 'file' }])
  })
  test('a nested path collapses to its top segment as a directory child, once', () => {
    const out = collapseToChildren(['src/a.ts', 'src/b.ts', 'src/deep/c.ts'])
    expect(out).toEqual([{ name: 'src', kind: 'dir' }])
  })
  test('directories sort before files, each alphabetically', () => {
    const out = collapseToChildren(['b.ts', 'a.ts', 'zdir/x.ts', 'adir/y.ts'])
    expect(out.map(c => c.name)).toEqual(['adir', 'zdir', 'a.ts', 'b.ts'])
  })
  test('a leading slash from a pathspec artifact is tolerated', () => {
    expect(collapseToChildren(['/a.ts'])).toEqual([{ name: 'a.ts', kind: 'file' }])
  })
  test('an empty list is an empty tree, not an error', () => {
    expect(collapseToChildren([])).toEqual([])
  })
})

describe('childrenFromDirents', () => {
  const dirent = (name: string, dir: boolean) => ({ name, isDirectory: () => dir })
  test('directories first, each side alphabetical', () => {
    const out = childrenFromDirents([
      dirent('b.ts', false), dirent('a.ts', false), dirent('zdir', true), dirent('adir', true),
    ])
    expect(out).toEqual([
      { name: 'adir', kind: 'dir' },
      { name: 'zdir', kind: 'dir' },
      { name: 'a.ts', kind: 'file' },
      { name: 'b.ts', kind: 'file' },
    ])
  })
})
