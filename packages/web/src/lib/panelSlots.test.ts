import { beforeEach, describe, expect, test } from 'bun:test'
import {
  DEFAULT_PLACEMENT, EMPTY_SLOT_LAYOUT, PANEL_IDS, allowed, bottomPanels, closePanel,
  getPanelLayout, hidePanel, hiddenPanels, hidePanelPlacement, isPanelId, isPanelShown, movePanel,
  openPanel, railPanels, readLayout, relocatePanel, reorderPlacement, resetPanelSlots,
  resolveForGates, resolveForViewport, restorePanelPlacement, rightSlotShowing, setBandOpen,
  setBottomOpen, setPlacement, setRightOpen, setSlotRightOpen, showPanel, subscribePanelLayout,
  type OpenPlacement, type PanelGates, type Placement,
} from './panelSlots'
import { answerUnsaved, getUnsaved, reportUnsaved, resetUnsaved } from './unsavedBuffers'

const PLACEMENTS: readonly Placement[] = ['rail', 'bottom', 'hidden']
const OPEN_PLACEMENTS: readonly OpenPlacement[] = ['rail', 'bottom']

function memory(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => map.clear(),
    key: () => null,
    get length() { return map.size },
  } as unknown as Storage
}

// ---------------------------------------------------------------------------------------------
// The fourteen panels, and `allowed`
// ---------------------------------------------------------------------------------------------

describe('PANEL_IDS', () => {
  test('is exactly the fourteen panels — the ten former Contents tabs plus studio/hardware/cli/shell', () => {
    expect(PANEL_IDS.slice().sort()).toEqual([
      'agents', 'cli', 'forks', 'gallery', 'hardware', 'live', 'mcps', 'metrics', 'prs', 'shell',
      'skills', 'studio', 'tasks', 'workflows',
    ])
  })

  test('has no duplicate', () => {
    expect(new Set(PANEL_IDS).size).toBe(PANEL_IDS.length)
  })
})

describe('isPanelId', () => {
  test('accepts every PANEL_IDS member and nothing else, including the retired "contents"', () => {
    for (const id of PANEL_IDS) expect(isPanelId(id)).toBe(true)
    expect(isPanelId('contents')).toBe(false)
    expect(isPanelId('bogus')).toBe(false)
    expect(isPanelId(null)).toBe(false)
    expect(isPanelId(42)).toBe(false)
  })
})

describe('allowed — every panel reaches every placement', () => {
  test('rail/bottom/hidden are all allowed for all fourteen panels', () => {
    for (const placement of PLACEMENTS) {
      for (const panel of PANEL_IDS) expect(allowed(placement, panel)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// Defaults (spec §1)
// ---------------------------------------------------------------------------------------------

describe('DEFAULT_PLACEMENT / EMPTY_SLOT_LAYOUT — a machine that has never touched this', () => {
  test('cli and shell default to bottom, every other panel defaults to rail', () => {
    for (const id of PANEL_IDS) {
      const want: Placement = id === 'cli' || id === 'shell' ? 'bottom' : 'rail'
      expect(DEFAULT_PLACEMENT[id]).toBe(want)
    }
  })

  test('nothing is hidden by default', () => {
    for (const id of PANEL_IDS) expect(EMPTY_SLOT_LAYOUT.placement[id]).not.toBe('hidden')
  })

  test('nothing is open by default — placement is not occupancy', () => {
    expect(EMPTY_SLOT_LAYOUT.right).toBeNull()
    expect(EMPTY_SLOT_LAYOUT.bottom).toBeNull()
    expect(EMPTY_SLOT_LAYOUT.bottomOpen).toBe(false)
  })

  test('railPanels/bottomPanels/hiddenPanels partition PANEL_IDS exactly, on the default layout', () => {
    const rail = railPanels(EMPTY_SLOT_LAYOUT)
    const bottom = bottomPanels(EMPTY_SLOT_LAYOUT)
    const hidden = hiddenPanels(EMPTY_SLOT_LAYOUT)
    expect(hidden).toEqual([])
    expect(bottom.slice().sort()).toEqual(['cli', 'shell'])
    expect(new Set([...rail, ...bottom])).toEqual(new Set(PANEL_IDS))
    expect(rail.length + bottom.length).toBe(PANEL_IDS.length)
  })
})

// ---------------------------------------------------------------------------------------------
// setPlacement / movePanel / hide / restore / reorder
// ---------------------------------------------------------------------------------------------

describe('setPlacement', () => {
  test('changes only the named panel’s placement', () => {
    const next = setPlacement(EMPTY_SLOT_LAYOUT, 'skills', 'bottom')
    expect(next.placement.skills).toBe('bottom')
    for (const id of PANEL_IDS) {
      if (id !== 'skills') expect(next.placement[id]).toBe(EMPTY_SLOT_LAYOUT.placement[id])
    }
  })

  test('is a no-op (same reference) when the panel is already there', () => {
    const next = setPlacement(EMPTY_SLOT_LAYOUT, 'cli', 'bottom')
    expect(next).toBe(EMPTY_SLOT_LAYOUT)
  })

  test('does NOT change which panel is the active occupant, unless hiding it', () => {
    const opened = openPanel(EMPTY_SLOT_LAYOUT, 'skills')
    expect(opened.right).toBe('skills')
    const moved = setPlacement(opened, 'skills', 'bottom')
    // placement changed; occupancy untouched (movePanel is the one that also reopens)
    expect(moved.placement.skills).toBe('bottom')
    expect(moved.right).toBe('skills')
  })

  test('hiding a panel that is the active occupant removes it from that slot', () => {
    const opened = openPanel(EMPTY_SLOT_LAYOUT, 'skills')
    const hidden = setPlacement(opened, 'skills', 'hidden')
    expect(hidden.placement.skills).toBe('hidden')
    expect(hidden.right).toBeNull()
  })

  test('hiding remembers restoreTo from the placement it was hidden FROM', () => {
    const onBottom = setPlacement(EMPTY_SLOT_LAYOUT, 'live', 'bottom')
    const hidden = setPlacement(onBottom, 'live', 'hidden')
    expect(hidden.restoreTo.live).toBe('bottom')
  })

  test('hiding an already-hidden panel keeps its existing restoreTo', () => {
    const onBottom = setPlacement(EMPTY_SLOT_LAYOUT, 'live', 'bottom')
    const hidden = setPlacement(onBottom, 'live', 'hidden')
    const rehidden = setPlacement(hidden, 'live', 'hidden') // no-op, same ref
    expect(rehidden).toBe(hidden)
  })

  test('a currently-placed panel’s restoreTo always mirrors its own placement', () => {
    for (const id of PANEL_IDS) {
      const restoreTo: string = EMPTY_SLOT_LAYOUT.restoreTo[id]
      expect(restoreTo).toBe(EMPTY_SLOT_LAYOUT.placement[id])
    }
  })
})

describe('restorePanelPlacement', () => {
  test('puts a hidden panel back where it was, without opening it', () => {
    const onBottom = setPlacement(EMPTY_SLOT_LAYOUT, 'live', 'bottom')
    const opened = openPanel(onBottom, 'live')
    const hidden = setPlacement(opened, 'live', 'hidden')
    const restored = restorePanelPlacement(hidden, 'live')
    expect(restored.placement.live).toBe('bottom')
    expect(restored.right).toBeNull()
    expect(restored.bottom).toBeNull()
  })

  test('is a no-op for a panel that is not hidden', () => {
    const next = restorePanelPlacement(EMPTY_SLOT_LAYOUT, 'live')
    expect(next).toBe(EMPTY_SLOT_LAYOUT)
  })
})

describe('hidePanelPlacement', () => {
  test('is setPlacement(..., "hidden") by another name', () => {
    const a = hidePanelPlacement(EMPTY_SLOT_LAYOUT, 'skills')
    const b = setPlacement(EMPTY_SLOT_LAYOUT, 'skills', 'hidden')
    expect(a).toEqual(b)
  })
})

describe('reorderPlacement', () => {
  test('reorders panels within one placement to match the given sequence', () => {
    const rail = railPanels(EMPTY_SLOT_LAYOUT)
    const reversed = [...rail].reverse()
    const next = reorderPlacement(EMPTY_SLOT_LAYOUT, 'rail', reversed)
    expect(railPanels(next)).toEqual(reversed)
  })

  test('an id from the OTHER placement in the given sequence is ignored', () => {
    const next = reorderPlacement(EMPTY_SLOT_LAYOUT, 'bottom', ['shell', 'live', 'cli'])
    expect(bottomPanels(next)).toEqual(['shell', 'cli'])
  })

  test('never touches placement, only order', () => {
    const next = reorderPlacement(EMPTY_SLOT_LAYOUT, 'rail', [...railPanels(EMPTY_SLOT_LAYOUT)].reverse())
    expect(next.placement).toEqual(EMPTY_SLOT_LAYOUT.placement)
  })
})

describe('movePanel — the gear’s verb', () => {
  test('sets placement AND opens the panel at the destination, displacing whatever was there', () => {
    const withCli = openPanel(EMPTY_SLOT_LAYOUT, 'cli') // bottom
    const moved = movePanel(withCli, 'skills', 'bottom')
    expect(moved.placement.skills).toBe('bottom')
    expect(moved.bottom).toBe('skills') // displaced cli
  })

  test('moving to the placement it is already in still (re)opens it there', () => {
    const next = movePanel(EMPTY_SLOT_LAYOUT, 'live', 'rail')
    expect(next.right).toBe('live')
  })

  for (const to of OPEN_PLACEMENTS) {
    test(`move to ${to} refreshes restoreTo to match`, () => {
      const next = movePanel(EMPTY_SLOT_LAYOUT, 'skills', to)
      expect(next.restoreTo.skills).toBe(to)
    })
  }
})

// ---------------------------------------------------------------------------------------------
// openPanel / closePanel / isPanelShown / rightSlotShowing
// ---------------------------------------------------------------------------------------------

describe('openPanel', () => {
  test('opens a rail-placed panel into the right slot', () => {
    const next = openPanel(EMPTY_SLOT_LAYOUT, 'skills')
    expect(next.right).toBe('skills')
    expect(next.rightOpen).toBe(true)
  })

  test('opens a bottom-placed panel into the bottom slot', () => {
    const next = openPanel(EMPTY_SLOT_LAYOUT, 'cli')
    expect(next.bottom).toBe('cli')
    expect(next.bottomOpen).toBe(true)
  })

  test('is REFUSED for a hidden panel — no icon or tab to have clicked', () => {
    const hidden = setPlacement(EMPTY_SLOT_LAYOUT, 'skills', 'hidden')
    const next = openPanel(hidden, 'skills')
    expect(next).toBe(hidden)
    expect(next.right).toBeNull()
  })

  test('opening a second rail panel displaces the first, never both at once', () => {
    const first = openPanel(EMPTY_SLOT_LAYOUT, 'skills')
    const second = openPanel(first, 'gallery')
    expect(second.right).toBe('gallery')
    expect(isPanelShown(second, 'skills')).toBe(false)
  })

  test('opening a rail panel never touches the bottom occupant, and vice versa', () => {
    const withCli = openPanel(EMPTY_SLOT_LAYOUT, 'cli')
    const withSkills = openPanel(withCli, 'skills')
    expect(withSkills.bottom).toBe('cli')
    expect(withSkills.right).toBe('skills')
  })
})

describe('closePanel / isPanelShown', () => {
  test('closes the active occupant, placement untouched', () => {
    const opened = openPanel(EMPTY_SLOT_LAYOUT, 'skills')
    const closed = closePanel(opened, 'skills')
    expect(closed.right).toBeNull()
    expect(closed.placement.skills).toBe('rail')
  })

  test('is a no-op for a panel that is not shown', () => {
    const next = closePanel(EMPTY_SLOT_LAYOUT, 'skills')
    expect(next).toBe(EMPTY_SLOT_LAYOUT)
  })

  test('isPanelShown reads true for a collapsed-but-occupying bottom panel', () => {
    const opened = setBottomOpen(openPanel(EMPTY_SLOT_LAYOUT, 'cli'), false)
    expect(isPanelShown(opened, 'cli')).toBe(true)
  })
})

describe('rightSlotShowing', () => {
  test('is a plain read of layout.right — every panel carries its own field now', () => {
    expect(rightSlotShowing(EMPTY_SLOT_LAYOUT)).toBeNull()
    expect(rightSlotShowing(openPanel(EMPTY_SLOT_LAYOUT, 'metrics'))).toBe('metrics')
  })
})

describe('setBottomOpen / setRightOpen', () => {
  test('toggle without touching the occupant', () => {
    const opened = openPanel(EMPTY_SLOT_LAYOUT, 'cli')
    const collapsed = setBottomOpen(opened, false)
    expect(collapsed.bottom).toBe('cli')
    expect(collapsed.bottomOpen).toBe(false)
  })

  test('are no-ops (same reference) when already at that value', () => {
    expect(setBottomOpen(EMPTY_SLOT_LAYOUT, false)).toBe(EMPTY_SLOT_LAYOUT)
    expect(setRightOpen(EMPTY_SLOT_LAYOUT, true)).toBe(EMPTY_SLOT_LAYOUT)
  })
})

// ---------------------------------------------------------------------------------------------
// resolveForViewport / resolveForGates
// ---------------------------------------------------------------------------------------------

describe('resolveForViewport', () => {
  test('desktop: untouched', () => {
    const layout = openPanel(EMPTY_SLOT_LAYOUT, 'skills')
    expect(resolveForViewport(layout, false)).toBe(layout)
  })

  test('mobile: a bottom-only panel reads as the right sheet instead', () => {
    const layout = movePanel(EMPTY_SLOT_LAYOUT, 'skills', 'bottom')
    const mobile = resolveForViewport(layout, true)
    expect(mobile.right).toBe('skills')
    expect(mobile.bottom).toBeNull()
    expect(mobile.rightOpen).toBe(true)
  })

  test('mobile: cli/shell are exempt — SessionPanel draws its own toggle for them', () => {
    const layout = openPanel(EMPTY_SLOT_LAYOUT, 'cli')
    expect(resolveForViewport(layout, true)).toBe(layout)
  })

  /**
   * LIVE BUG, FOUND VERIFYING THE MOBILE SWITCHER: with `bottom` holding a non-cli/shell panel
   * (e.g. `studio`, moved there by the gear, or carried over from a migrated layout) and NOTHING on
   * `right` yet, the fold correctly opens it as the sheet — but the mobile switcher's own click only
   * ever writes `right` (`SessionsPage.tsx`'s `openSlotPanel`, which never touches `bottom`), so
   * without this guard the NEXT render folded `bottom` straight back over whatever was just picked.
   * Measured live: tapping "Skills" while `bottom` held `studio` left the panel on Studio forever —
   * the switcher was reachable but inert.
   */
  test('mobile: once something real sits on the right, the fold stops overriding it', () => {
    const layout = movePanel(EMPTY_SLOT_LAYOUT, 'studio', 'bottom')
    const firstFold = resolveForViewport(layout, true)
    expect(firstFold.right).toBe('studio') // the fold's own first-time behaviour, unchanged

    // The reader picks something else from the mobile switcher — writes RAW `right` only.
    const picked = openPanel(layout, 'skills')
    expect(picked.bottom).toBe('studio') // untouched — the switcher never writes `bottom`
    const resolved = resolveForViewport(picked, true)
    expect(resolved.right).toBe('skills') // the pick wins, not another fold of `bottom`
  })

  test('mobile: nothing at the bottom is untouched', () => {
    expect(resolveForViewport(EMPTY_SLOT_LAYOUT, true)).toBe(EMPTY_SLOT_LAYOUT)
  })
})

describe('resolveForGates', () => {
  const OPEN: PanelGates = { editorEnabled: true, shellEnabled: true, relayed: false }

  test('every panel stays when every gate is open', () => {
    const layout = openPanel(openPanel(EMPTY_SLOT_LAYOUT, 'studio'), 'shell')
    expect(resolveForGates(layout, OPEN)).toBe(layout)
  })

  test('a shown studio closes when editorEnabled is false', () => {
    const layout = openPanel(EMPTY_SLOT_LAYOUT, 'studio')
    const gated = resolveForGates(layout, { ...OPEN, editorEnabled: false })
    expect(gated.right).toBeNull()
  })

  test('cli/shell close when relayed', () => {
    const layout = openPanel(EMPTY_SLOT_LAYOUT, 'cli')
    const gated = resolveForGates(layout, { ...OPEN, relayed: true })
    expect(gated.bottom).toBeNull()
  })

  test('the ten former Contents tabs and hardware carry no gate of their own', () => {
    const layout = openPanel(EMPTY_SLOT_LAYOUT, 'metrics')
    const gated = resolveForGates(layout, { editorEnabled: false, shellEnabled: false, relayed: true })
    expect(gated.right).toBe('metrics')
  })
})

// ---------------------------------------------------------------------------------------------
// Migration — readLayout
// ---------------------------------------------------------------------------------------------

describe('readLayout — a fresh machine', () => {
  test('no stored value at all reads as the plain defaults', () => {
    expect(readLayout(memory())).toEqual(EMPTY_SLOT_LAYOUT)
  })
})

describe('readLayout — unreadable or unrecognisable storage', () => {
  test('non-JSON never throws, reads as defaults', () => {
    const s = memory()
    s.setItem('agentistics-panel-slots', 'not json at all {{{')
    expect(readLayout(s)).toEqual(EMPTY_SLOT_LAYOUT)
  })

  test('a bare JSON primitive (not an object) reads as defaults', () => {
    const s = memory()
    s.setItem('agentistics-panel-slots', '42')
    expect(readLayout(s)).toEqual(EMPTY_SLOT_LAYOUT)
  })

  test('a storage whose getItem throws reads as defaults, never propagates', () => {
    const s = {
      getItem: () => { throw new Error('blocked') },
    } as unknown as Storage
    expect(readLayout(s)).toEqual(EMPTY_SLOT_LAYOUT)
  })

  test('a value "from a future version" — unknown top-level fields, a placement id this build does not know — degrades to known fields rather than throwing', () => {
    const s = memory()
    s.setItem('agentistics-panel-slots', JSON.stringify({
      version: 99,
      placement: { ...DEFAULT_PLACEMENT, skills: 'bottom', someFuturePanel: 'rail' },
      order: { skills: 3 },
      restoreTo: { skills: 'bottom' },
      right: 'someFuturePanel',
      bottom: 'skills',
      bottomOpen: true,
      rightOpen: true,
      aBrandNewField: { nested: true },
    }))
    const layout = readLayout(s)
    expect(layout.placement.skills).toBe('bottom')
    // the unknown id is simply not a PanelId — never adopted as an occupant or a placement key
    expect(layout.right).toBeNull()
    expect(layout.bottom).toBe('skills')
    expect(layout.order.skills).toBe(3)
  })
})

describe('readLayout — migrating the OLD (pre-rail) shape', () => {
  test('a bare fresh-defaults-shaped legacy value (nothing ever opened) still reads as today’s defaults', () => {
    const s = memory()
    s.setItem('agentistics-panel-slots', JSON.stringify({
      right: null, bottom: null, bottomOpen: false, rightOpen: true,
      lastSlot: {
        contents: 'right', studio: 'right', cli: 'bottom', shell: 'bottom', hardware: 'right',
      },
    }))
    const layout = readLayout(s)
    expect(layout.placement).toEqual(DEFAULT_PLACEMENT)
    expect(layout.right).toBeNull()
    expect(layout.bottom).toBeNull()
  })

  test('studio parked at the bottom under the old model stays at the bottom under the new one', () => {
    const s = memory()
    s.setItem('agentistics-panel-slots', JSON.stringify({
      right: null, bottom: 'studio', bottomOpen: true, rightOpen: true,
      lastSlot: { contents: 'right', studio: 'bottom', cli: 'bottom', shell: 'bottom', hardware: 'right' },
    }))
    const layout = readLayout(s)
    expect(layout.placement.studio).toBe('bottom')
    expect(layout.bottom).toBe('studio')
    expect(layout.bottomOpen).toBe(true)
  })

  test('"contents" open on the RIGHT migrates to its ten descendants placed on the rail, opened on "live"', () => {
    const s = memory()
    s.setItem('agentistics-panel-slots', JSON.stringify({
      right: 'contents', bottom: null, bottomOpen: false, rightOpen: true,
      lastSlot: { contents: 'right', studio: 'right', cli: 'bottom', shell: 'bottom', hardware: 'right' },
    }))
    const layout = readLayout(s)
    for (const id of ['live', 'gallery', 'skills', 'agents', 'forks', 'workflows', 'mcps', 'prs', 'tasks', 'metrics'] as const) {
      expect(layout.placement[id]).toBe('rail')
    }
    expect(layout.right).toBe('live')
  })

  test('"contents" DOCKED AT THE BOTTOM still places its ten descendants on the RAIL, not the bottom — the spec’s own rule, not "wherever contents was"', () => {
    const s = memory()
    s.setItem('agentistics-panel-slots', JSON.stringify({
      right: null, bottom: 'contents', bottomOpen: true, rightOpen: true,
      lastSlot: { contents: 'bottom', studio: 'right', cli: 'bottom', shell: 'bottom', hardware: 'right' },
    }))
    const layout = readLayout(s)
    for (const id of ['live', 'gallery', 'skills', 'agents', 'forks', 'workflows', 'mcps', 'prs', 'tasks', 'metrics'] as const) {
      expect(layout.placement[id]).toBe('rail')
    }
    expect(layout.bottom).toBe('live')
  })

  test('hardware on the right, shell at the bottom — both preserved', () => {
    const s = memory()
    s.setItem('agentistics-panel-slots', JSON.stringify({
      right: 'hardware', bottom: 'shell', bottomOpen: true, rightOpen: true,
      lastSlot: { contents: 'right', studio: 'right', cli: 'bottom', shell: 'bottom', hardware: 'right' },
    }))
    const layout = readLayout(s)
    expect(layout.placement.hardware).toBe('rail')
    expect(layout.right).toBe('hardware')
    expect(layout.placement.shell).toBe('bottom')
    expect(layout.bottom).toBe('shell')
  })

  test('migration never throws on a legacy value missing lastSlot entirely', () => {
    const s = memory()
    s.setItem('agentistics-panel-slots', JSON.stringify({ right: 'studio', bottom: null }))
    const layout = readLayout(s)
    expect(layout.right).toBe('studio')
    expect(layout.placement.studio).toBe('rail')
  })
})

describe('readLayout — round-trips every PANEL_IDS member through write→read', () => {
  for (const id of PANEL_IDS) {
    test(`${id} on the rail`, () => {
      const s = memory()
      const written = movePanel(EMPTY_SLOT_LAYOUT, id, 'rail')
      s.setItem('agentistics-panel-slots', JSON.stringify({ version: 2, ...written }))
      expect(readLayout(s).right).toBe(id)
    })

    test(`${id} at the bottom`, () => {
      const s = memory()
      const written = movePanel(EMPTY_SLOT_LAYOUT, id, 'bottom')
      s.setItem('agentistics-panel-slots', JSON.stringify({ version: 2, ...written }))
      expect(readLayout(s).bottom).toBe(id)
    })

    test(`${id} hidden — round-trips its placement and restoreTo`, () => {
      const s = memory()
      const written = hidePanelPlacement(EMPTY_SLOT_LAYOUT, id)
      s.setItem('agentistics-panel-slots', JSON.stringify({ version: 2, ...written }))
      const read = readLayout(s)
      expect(read.placement[id]).toBe('hidden')
      expect(read.restoreTo[id]).toBe(written.restoreTo[id])
    })
  }
})

// ---------------------------------------------------------------------------------------------
// The imperative store — showPanel / hidePanel / relocatePanel / the unsaved-Studio hold
// ---------------------------------------------------------------------------------------------

describe('the imperative store', () => {
  beforeEach(() => { resetPanelSlots(); resetUnsaved() })

  test('showPanel opens and persists; a fresh getPanelLayout/subscribe pair see it', () => {
    let notified = 0
    const unsub = subscribePanelLayout(() => { notified += 1 })
    showPanel('skills')
    expect(getPanelLayout().right).toBe('skills')
    expect(notified).toBe(1)
    unsub()
  })

  test('showPanel over an already-open Studio with unsaved buffers HOLDS, asking first', () => {
    showPanel('studio')
    reportUnsaved('studio', ['a.ts'])
    showPanel('skills') // would displace the dirty Studio
    expect(getPanelLayout().right).toBe('studio') // not yet displaced
    expect(getUnsaved().question?.cause).toBe('close')
    answerUnsaved(true) // discard
    expect(getPanelLayout().right).toBe('skills')
  })

  test('showPanel moving the Studio to another slot never asks — it stays shown throughout', () => {
    showPanel('studio')
    reportUnsaved('studio', ['a.ts'])
    relocatePanel('studio', 'bottom')
    expect(getPanelLayout().bottom).toBe('studio')
    expect(getUnsaved().question).toBeNull()
  })

  test('hidePanel on the Studio with unsaved buffers holds; "keep editing" leaves it shown', () => {
    showPanel('studio')
    reportUnsaved('studio', ['a.ts'])
    let afterRan = false
    hidePanel('studio', () => { afterRan = true })
    expect(getPanelLayout().right).toBe('studio')
    expect(afterRan).toBe(false)
    answerUnsaved(false) // keep editing
    expect(getPanelLayout().right).toBe('studio')
    expect(afterRan).toBe(false)
  })

  test('relocatePanel moves and opens at the destination', () => {
    showPanel('live')
    relocatePanel('live', 'bottom')
    expect(getPanelLayout().bottom).toBe('live')
    expect(getPanelLayout().placement.live).toBe('bottom')
  })

  test('setBandOpen / setSlotRightOpen toggle the persisted layout', () => {
    showPanel('cli')
    setBandOpen(false)
    expect(getPanelLayout().bottomOpen).toBe(false)
    setSlotRightOpen(false)
    expect(getPanelLayout().rightOpen).toBe(false)
  })
})
