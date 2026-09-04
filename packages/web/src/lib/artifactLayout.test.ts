import { describe, expect, it } from 'bun:test'
import { edgeHint, resolveArtifactLayout, shouldAutoOpen } from './artifactLayout'

const at = (o: Partial<Parameters<typeof resolveArtifactLayout>[0]>) =>
  resolveArtifactLayout({ open: true, width: 1440, isMobile: false, listExpandedByUser: false, ...o })

describe('resolveArtifactLayout', () => {
  it('is closed when it is closed, and asks for no collapse', () => {
    expect(at({ open: false })).toEqual({ layout: 'closed', collapseList: false })
  })

  it('opens split and collapses the fleet list to the rail', () => {
    expect(at({})).toEqual({ layout: 'split-rail', collapseList: true })
  })

  it('KEEPS the list when the user expanded it themselves — their choice wins', () => {
    expect(at({ listExpandedByUser: true })).toEqual({ layout: 'split', collapseList: false })
  })

  it('becomes an overlay below the three-column floor, whatever the user chose', () => {
    expect(at({ width: 1000 })).toEqual({ layout: 'overlay', collapseList: false })
    expect(at({ width: 1000, listExpandedByUser: true }))
      .toEqual({ layout: 'overlay', collapseList: false })
  })

  it('is full-screen on mobile, at any width', () => {
    expect(at({ isMobile: true })).toEqual({ layout: 'fullscreen', collapseList: false })
    expect(at({ isMobile: true, width: 1440 })).toEqual({ layout: 'fullscreen', collapseList: false })
  })

  it('never asks to collapse the list in a layout that does not use the rail', () => {
    for (const o of [{ width: 1000 }, { isMobile: true }, { open: false }]) {
      expect(at(o).collapseList, JSON.stringify(o)).toBe(false)
    }
  })
})

describe('shouldAutoOpen', () => {
  const auto = (o: Partial<Parameters<typeof shouldAutoOpen>[0]> = {}) => shouldAutoOpen({
    writing: true, wasWriting: false, open: false, dismissed: false, isMobile: false, ...o,
  })

  it('opens when the session STARTS writing a file', () => {
    expect(auto()).toBe(true)
  })

  it('fires on the transition, never on the level — or it could not be closed', () => {
    expect(auto({ wasWriting: true })).toBe(false)
  })

  it('stays shut once the person closed it — an automatic open is a suggestion', () => {
    expect(auto({ dismissed: true })).toBe(false)
  })

  it('does nothing when it is already open', () => {
    expect(auto({ open: true })).toBe(false)
  })

  it('never opens itself on a phone, where it would cover the conversation', () => {
    expect(auto({ isMobile: true })).toBe(false)
  })

  it('needs a file being WRITTEN, not merely a busy session', () => {
    // Thinking, searching and running tests have nothing to show here.
    expect(auto({ writing: false })).toBe(false)
  })
})

describe('edgeHint', () => {
  const running = [
    { kind: 'read' as const, text: 'a.ts', live: true },
    { kind: 'wrote' as const, text: 'b.ts', live: true },
  ]

  it('names the LAST thing in flight — a verb tells you whether you care, a count does not', () => {
    expect(edgeHint({ open: false, events: running, isMobile: false }))
      .toEqual({ kind: 'wrote', text: 'b.ts' })
  })

  it('says nothing while the panel is open — it is already saying this, in full', () => {
    expect(edgeHint({ open: true, events: running, isMobile: false })).toBeNull()
  })

  it('says nothing on a phone, where the panel would cover what is being read', () => {
    expect(edgeHint({ open: false, events: running, isMobile: true })).toBeNull()
  })

  it('FINISHED actions are history and belong in the panel, not on the edge', () => {
    const done = [{ kind: 'wrote' as const, text: 'b.ts' }]
    expect(edgeHint({ open: false, events: done, isMobile: false })).toBeNull()
    expect(edgeHint({ open: false, events: [], isMobile: false })).toBeNull()
  })
})
