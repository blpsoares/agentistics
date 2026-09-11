/**
 * repoTreeModel.ts — PURE: the lazy tree's shape, and the open-tabs strip's shape.
 *
 * The tree is a plain recursive structure keyed by PATH (root-relative, '/'-joined, '' for the
 * root itself) — every update below finds a node by walking the tree and replacing the matched
 * node with a new one, which is what keeps the whole thing trivially testable without React.
 *
 * `TreeChild` is redeclared here rather than imported from the server's `editor-list.ts` (same
 * shape: `{ name, kind: 'file' | 'dir' }`) — `packages/web/src/*` may never import
 * `packages/server/server/*` (Vite would try to bundle Node-only code), and this type is too
 * small and too specific to this view model to be worth promoting into `@agentistics/core`.
 *
 * COLLAPSING NEVER DROPS CACHED CHILDREN. A directory's `children` stays populated after it is
 * collapsed; only `expanded` flips. Re-opening it is then instant and costs no fetch — the caller
 * only calls the `/api/fleet/tree` route the FIRST time a directory's `children` is still `null`.
 * That `null` is load-bearing: it is the one thing that tells the caller "never fetched", distinct
 * from a real, loaded, empty directory (`children: []`) — the same N/A-versus-a-confident-0 rule
 * this codebase applies everywhere else, applied here to "has this directory been read yet".
 */

export interface TreeChild {
  name: string
  kind: 'file' | 'dir'
}

export interface TreeNode {
  path: string
  name: string
  kind: 'file' | 'dir'
  expanded: boolean
  loading: boolean
  /** `null` = never loaded. An empty array is a real, loaded, empty directory. */
  children: TreeNode[] | null
  error?: string
}

export function makeRootNode(): TreeNode {
  return { path: '', name: '', kind: 'dir', expanded: true, loading: false, children: null }
}

/** Finds `path` by walking the tree and replaces just that node — every other update goes through this. */
function updateNode(node: TreeNode, path: string, fn: (n: TreeNode) => TreeNode): TreeNode {
  if (node.path === path) return fn(node)
  if (!node.children) return node
  return { ...node, children: node.children.map(c => updateNode(c, path, fn)) }
}

export function setLoading(root: TreeNode, path: string, loading: boolean): TreeNode {
  return updateNode(root, path, n => ({ ...n, loading }))
}

export function applyChildren(root: TreeNode, path: string, children: readonly TreeChild[]): TreeNode {
  return updateNode(root, path, n => ({
    ...n,
    loading: false,
    error: undefined,
    children: children.map(c => ({
      path: path === '' ? c.name : `${path}/${c.name}`,
      name: c.name,
      kind: c.kind,
      expanded: false,
      loading: false,
      children: null,
    })),
  }))
}

export function applyError(root: TreeNode, path: string, error: string): TreeNode {
  return updateNode(root, path, n => ({ ...n, loading: false, error }))
}

export function toggleExpanded(root: TreeNode, path: string): TreeNode {
  return updateNode(root, path, n => ({ ...n, expanded: !n.expanded }))
}

export interface FlatRow {
  path: string
  name: string
  kind: 'file' | 'dir'
  depth: number
  expanded: boolean
  loading: boolean
  error?: string
}

/** Depth-first, only what is currently EXPANDED — this is what the virtualized list renders. */
export function flattenVisible(root: TreeNode): FlatRow[] {
  const out: FlatRow[] = []
  const walk = (node: TreeNode, depth: number) => {
    const row: FlatRow = {
      path: node.path, name: node.name, kind: node.kind, depth,
      expanded: node.expanded, loading: node.loading,
    }
    if (node.error !== undefined) row.error = node.error
    out.push(row)
    if (node.kind === 'dir' && node.expanded && node.children) {
      for (const c of node.children) walk(c, depth + 1)
    }
  }
  if (root.children) for (const c of root.children) walk(c, 0)
  return out
}

export interface OpenTab {
  path: string
  dirty: boolean
}

export function openTab(tabs: readonly OpenTab[], path: string): OpenTab[] {
  if (tabs.some(t => t.path === path)) return [...tabs]
  return [...tabs, { path, dirty: false }]
}

export function closeTab(tabs: readonly OpenTab[], path: string): OpenTab[] {
  return tabs.filter(t => t.path !== path)
}

export function markDirty(tabs: readonly OpenTab[], path: string, dirty: boolean): OpenTab[] {
  return tabs.map(t => (t.path === path ? { ...t, dirty } : t))
}
