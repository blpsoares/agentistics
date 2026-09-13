import { beforeEach, describe, expect, test } from 'bun:test'
import {
  DEFAULT_LAST_SLOT, EMPTY_SLOT_LAYOUT, PANEL_IDS, allowed, closePanel, getPanelLayout,
  hidePanel, isPanelShown, movePanel, openPanel, readLayout, relocatePanel, resetPanelSlots,
  resolveForViewport, setBottomOpen, showPanel, subscribePanelLayout,
  type PanelId, type SlotId, type SlotLayout,
} from './panelSlots'
import { answerUnsaved, getUnsaved, reportUnsaved, resetUnsaved } from './unsavedBuffers'

const SLOTS: readonly SlotId[] = ['right', 'bottom']

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

describe('allowed — the closed sets', () => {
  test('right hosts all four panels', () => {
    for (const p of PANEL_IDS) expect(allowed('right', p)).toBe(true)
  })

  test('bottom hosts everything but contents — a tabbed list does not fit a band', () => {
    expect(allowed('bottom', 'contents')).toBe(false)
    expect(allowed('bottom', 'studio')).toBe(true)
    expect(allowed('bottom', 'cli')).toBe(true)
    expect(allowed('bottom', 'shell')).toBe(true)
  })
})

describe('openPanel — exhaustive, every panel × slot × starting occupant', () => {
  test('opening into an empty slot with an explicit slot places it there and remembers it', () => {
    for (const panel of PANEL_IDS) {
      for (const slot of SLOTS) {
        if (!allowed(slot, panel)) continue
        const next = openPanel(EMPTY_SLOT_LAYOUT, panel, slot)
        expect(next[slot]).toBe(panel)
        expect(next.lastSlot[panel]).toBe(slot)
        // The other slot is untouched.
        const other: SlotId = slot === 'right' ? 'bottom' : 'right'
        expect(next[other]).toBe(EMPTY_SLOT_LAYOUT[other])
      }
    }
  })

  test('an illegal placement is REFUSED — same object, nothing coerced', () => {
    const next = openPanel(EMPTY_SLOT_LAYOUT, 'contents', 'bottom')
    expect(next).toBe(EMPTY_SLOT_LAYOUT)
  })

  test('with no slot given, it falls back to lastSlot, then to the panel’s default', () => {
    expect(openPanel(EMPTY_SLOT_LAYOUT, 'studio').right).toBe('studio')
    expect(openPanel(EMPTY_SLOT_LAYOUT, 'cli').bottom).toBe('cli')
    const remembered: SlotLayout = {
      ...EMPTY_SLOT_LAYOUT, lastSlot: { ...DEFAULT_LAST_SLOT, cli: 'right' },
    }
    expect(openPanel(remembered, 'cli').right).toBe('cli')
  })

  test('opening a panel where another already sits DISPLACES it — the other stops being shown anywhere', () => {
    const withCli = openPanel(EMPTY_SLOT_LAYOUT, 'cli', 'right')
    const next = openPanel(withCli, 'studio', 'right')
    expect(next.right).toBe('studio')
    expect(isPanelShown(next, 'cli')).toBe(false)
  })

  test('opening a panel already in the OTHER slot MOVES it rather than duplicating it', () => {
    const bottomCli = openPanel(EMPTY_SLOT_LAYOUT, 'cli', 'bottom')
    const next = openPanel(bottomCli, 'cli', 'right')
    expect(next.right).toBe('cli')
    expect(next.bottom).toBeNull()
  })

  test('opening bottom always expands the band', () => {
    const next = openPanel({ ...EMPTY_SLOT_LAYOUT, bottomOpen: false }, 'shell', 'bottom')
    expect(next.bottomOpen).toBe(true)
  })

  test('opening the panel already exactly where it is is a genuine no-op (idempotent) beyond the values', () => {
    const once = openPanel(EMPTY_SLOT_LAYOUT, 'studio', 'right')
    const twice = openPanel(once, 'studio', 'right')
    expect(twice.right).toBe('studio')
    expect(twice.bottom).toBeNull()
  })

  test('every panel can open into every slot that allows it, from every starting occupant, including itself', () => {
    for (const slot of SLOTS) {
      for (const panel of PANEL_IDS) {
        if (!allowed(slot, panel)) continue
        for (const occupant of [null, ...PANEL_IDS] as (PanelId | null)[]) {
          if (occupant !== null && !allowed(slot, occupant)) continue
          const start: SlotLayout = { ...EMPTY_SLOT_LAYOUT, [slot]: occupant }
          const next = openPanel(start, panel, slot)
          expect(next[slot]).toBe(panel)
        }
      }
    }
  })
})

describe('closePanel', () => {
  test('removes the panel from wherever it sits', () => {
    const shown = openPanel(EMPTY_SLOT_LAYOUT, 'studio', 'right')
    expect(closePanel(shown, 'studio')).toEqual(EMPTY_SLOT_LAYOUT)
  })

  test('a panel not shown anywhere closes as a no-op — same object', () => {
    expect(closePanel(EMPTY_SLOT_LAYOUT, 'studio')).toBe(EMPTY_SLOT_LAYOUT)
  })

  test('closing one panel never touches the other slot', () => {
    const both: SlotLayout = { ...EMPTY_SLOT_LAYOUT, right: 'contents', bottom: 'cli', bottomOpen: true }
    const next = closePanel(both, 'contents')
    expect(next.bottom).toBe('cli')
    expect(next.bottomOpen).toBe(true)
  })
})

describe('movePanel', () => {
  test('moves a shown panel to the other slot, displacing whatever was there', () => {
    const start: SlotLayout = { ...EMPTY_SLOT_LAYOUT, right: 'studio', bottom: 'cli', bottomOpen: true }
    const next = movePanel(start, 'studio', 'bottom')
    expect(next.bottom).toBe('studio')
    expect(next.right).toBeNull()
    expect(isPanelShown(next, 'cli')).toBe(false)
  })

  test('a panel not shown anywhere cannot be moved — no-op', () => {
    expect(movePanel(EMPTY_SLOT_LAYOUT, 'studio', 'bottom')).toBe(EMPTY_SLOT_LAYOUT)
  })

  test('moving to the slot it is already in is a no-op', () => {
    const start = openPanel(EMPTY_SLOT_LAYOUT, 'shell', 'bottom')
    expect(movePanel(start, 'shell', 'bottom')).toBe(start)
  })

  test('a move to an illegal slot is refused', () => {
    const start = openPanel(EMPTY_SLOT_LAYOUT, 'contents', 'right')
    expect(movePanel(start, 'contents', 'bottom')).toBe(start)
  })

  test('every legal move, from every legal starting position, lands exactly where asked', () => {
    for (const panel of PANEL_IDS) {
      for (const from of SLOTS) {
        if (!allowed(from, panel)) continue
        for (const to of SLOTS) {
          if (to === from || !allowed(to, panel)) continue
          const start = openPanel(EMPTY_SLOT_LAYOUT, panel, from)
          const next = movePanel(start, panel, to)
          expect(next[to]).toBe(panel)
          expect(next[from]).toBeNull()
        }
      }
    }
  })
})

describe('isPanelShown', () => {
  test('true in either slot, including a collapsed bottom band', () => {
    expect(isPanelShown({ ...EMPTY_SLOT_LAYOUT, right: 'contents' }, 'contents')).toBe(true)
    expect(isPanelShown({ ...EMPTY_SLOT_LAYOUT, bottom: 'shell', bottomOpen: false }, 'shell')).toBe(true)
  })

  test('false when it sits nowhere', () => {
    expect(isPanelShown(EMPTY_SLOT_LAYOUT, 'studio')).toBe(false)
  })
})

describe('setBottomOpen', () => {
  test('flips the flag without touching the occupant', () => {
    const start: SlotLayout = { ...EMPTY_SLOT_LAYOUT, bottom: 'cli', bottomOpen: true }
    expect(setBottomOpen(start, false)).toEqual({ ...start, bottomOpen: false })
  })

  test('setting the same value is a no-op — same object', () => {
    expect(setBottomOpen(EMPTY_SLOT_LAYOUT, false)).toBe(EMPTY_SLOT_LAYOUT)
  })
})

describe('resolveForViewport — the phone reading', () => {
  test('a stored bottom studio becomes the fullscreen right sheet on a phone', () => {
    const stored: SlotLayout = { ...EMPTY_SLOT_LAYOUT, bottom: 'studio', bottomOpen: true }
    const seen = resolveForViewport(stored, true)
    expect(seen.right).toBe('studio')
    expect(seen.bottom).toBeNull()
  })

  test('desktop reads the layout untouched', () => {
    const stored: SlotLayout = { ...EMPTY_SLOT_LAYOUT, bottom: 'studio', bottomOpen: true }
    expect(resolveForViewport(stored, false)).toBe(stored)
  })

  test('mobile with nothing studio-shaped in the bottom is untouched', () => {
    const stored: SlotLayout = { ...EMPTY_SLOT_LAYOUT, bottom: 'shell', bottomOpen: true }
    expect(resolveForViewport(stored, true)).toBe(stored)
  })

  test('turning the phone back into a desktop restores the ORIGINAL stored layout — nothing was rewritten', () => {
    const stored: SlotLayout = { ...EMPTY_SLOT_LAYOUT, bottom: 'studio', bottomOpen: true }
    resolveForViewport(stored, true) // read as a phone once
    // The desktop reading is computed fresh from the SAME stored value, never from the phone's view.
    expect(resolveForViewport(stored, false)).toEqual(stored)
  })
})

describe('the storage guard — readLayout', () => {
  test('no stored value reads as the empty layout', () => {
    expect(readLayout(memory())).toEqual(EMPTY_SLOT_LAYOUT)
  })

  test('round-trips a real layout', () => {
    const s = memory()
    const layout = openPanel(openPanel(EMPTY_SLOT_LAYOUT, 'studio', 'right'), 'shell', 'bottom')
    s.setItem('agentistics-panel-slots', JSON.stringify(layout))
    expect(readLayout(s)).toEqual(layout)
  })

  test('a storage that throws on read costs nothing', () => {
    const hostile = { getItem() { throw new Error('blocked') } } as unknown as Storage
    expect(() => readLayout(hostile)).not.toThrow()
    expect(readLayout(hostile)).toEqual(EMPTY_SLOT_LAYOUT)
  })

  test('junk in storage reads as empty rather than as a broken layout', () => {
    const s = memory()
    s.setItem('agentistics-panel-slots', 'not json')
    expect(readLayout(s)).toEqual(EMPTY_SLOT_LAYOUT)
  })

  test('an illegal occupant recorded by hand (or by an older build) is dropped, not trusted', () => {
    const s = memory()
    s.setItem('agentistics-panel-slots', JSON.stringify({ right: null, bottom: 'contents', bottomOpen: true }))
    expect(readLayout(s).bottom).toBeNull()
  })

  test('bottomOpen with no bottom occupant reads as false — nothing to show', () => {
    const s = memory()
    s.setItem('agentistics-panel-slots', JSON.stringify({ right: null, bottom: null, bottomOpen: true }))
    expect(readLayout(s).bottomOpen).toBe(false)
  })

  test('an unreadable lastSlot entry falls back to the default for that panel only', () => {
    const s = memory()
    s.setItem('agentistics-panel-slots', JSON.stringify({
      right: null, bottom: null, bottomOpen: false,
      // `contents` cannot host at the bottom (so that entry is dropped), `cli`'s value is not even
      // a slot name, and `studio` really can sit at the bottom — that one is kept.
      lastSlot: { contents: 'bottom', cli: 'nowhere', studio: 'bottom' },
    }))
    expect(readLayout(s).lastSlot).toEqual({ ...DEFAULT_LAST_SLOT, studio: 'bottom' })
  })
})

describe('the imperative store — showPanel / hidePanel / relocatePanel', () => {
  beforeEach(() => { resetPanelSlots(); resetUnsaved() })

  test('showPanel places a panel and notifies subscribers', () => {
    let notified = 0
    const unsub = subscribePanelLayout(() => { notified += 1 })
    showPanel('studio')
    expect(getPanelLayout().right).toBe('studio')
    expect(notified).toBe(1)
    unsub()
  })

  test('relocatePanel moves without asking, even with unsaved buffers', () => {
    showPanel('studio', 'right')
    reportUnsaved('studio', ['README.md'])
    relocatePanel('studio', 'bottom')
    expect(getPanelLayout().bottom).toBe('studio')
    expect(getUnsaved().question).toBeNull()
  })

  test('displacing a dirty Studio out of every slot is HELD until the reader discards', () => {
    showPanel('studio', 'right')
    reportUnsaved('studio', ['README.md'])
    showPanel('contents', 'right')
    // Held: the Studio is still the one shown, nothing committed yet.
    expect(getPanelLayout().right).toBe('studio')
    expect(getUnsaved().question).toEqual({ cause: 'close' })
    answerUnsaved(true)
    expect(getPanelLayout().right).toBe('contents')
  })

  test('"keep editing" leaves the Studio exactly where it was', () => {
    showPanel('studio', 'right')
    reportUnsaved('studio', ['README.md'])
    showPanel('contents', 'right')
    answerUnsaved(false)
    expect(getPanelLayout().right).toBe('studio')
  })

  test('hidePanel on a dirty Studio asks too', () => {
    showPanel('studio')
    reportUnsaved('studio', ['a.ts'])
    hidePanel('studio')
    expect(isPanelShown(getPanelLayout(), 'studio')).toBe(true)
    answerUnsaved(true)
    expect(isPanelShown(getPanelLayout(), 'studio')).toBe(false)
  })

  test('closing a clean Studio asks nothing', () => {
    showPanel('studio')
    hidePanel('studio')
    expect(isPanelShown(getPanelLayout(), 'studio')).toBe(false)
    expect(getUnsaved().question).toBeNull()
  })

  test('displacing something that is not the Studio never asks', () => {
    showPanel('cli', 'right')
    showPanel('studio', 'right')
    expect(getPanelLayout().right).toBe('studio')
    expect(getUnsaved().question).toBeNull()
  })
})
