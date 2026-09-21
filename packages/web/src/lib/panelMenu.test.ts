import { describe, expect, test } from 'bun:test'
import { allowed, PANEL_IDS, type OpenPlacement, type PanelId } from './panelSlots'
import { PANEL_META } from './panelMeta'
import { fullscreenModeFor, panelMenuEntries, panelMinimizeAction, type PanelMenuEntry } from './panelMenu'

const PLACEMENTS: readonly OpenPlacement[] = ['rail', 'bottom']

function names(entries: readonly PanelMenuEntry[]): string[] {
  return entries.map(e => e.id)
}

describe('panelMenuEntries — the one builder every placement menu goes through', () => {
  test('every panel reaches both placements, so every panel offers a move row from each', () => {
    for (const panel of PANEL_IDS) {
      const fromRail = panelMenuEntries({ panel, placement: 'rail', lang: 'en', panelName: panel })
      expect(names(fromRail)).toContain('move-bottom')
      expect(names(fromRail)).not.toContain('move-right')

      const fromBottom = panelMenuEntries({ panel, placement: 'bottom', lang: 'en', panelName: panel })
      expect(names(fromBottom)).toContain('move-right')
      expect(names(fromBottom)).not.toContain('move-bottom')
    }
  })

  test('every entry names ONLY the panel this menu belongs to, never another one', () => {
    const other: Record<PanelId, string> = Object.fromEntries(
      PANEL_IDS.map(id => [id, PANEL_META[id].title.pt]),
    ) as Record<PanelId, string>
    for (const panel of PANEL_IDS) {
      for (const placement of PLACEMENTS) {
        if (!allowed(placement, panel)) continue
        const entries = panelMenuEntries({ panel, placement, lang: 'pt', panelName: other[panel] })
        for (const entry of entries) {
          expect(entry.label).toContain(other[panel])
          for (const [otherPanel, otherName] of Object.entries(other)) {
            if (otherPanel === panel) continue
            // A handful of titles legitimately share a substring in Portuguese/English (e.g. none
            // currently do among the fourteen) — this loop still guards against a future collision.
            expect(entry.label).not.toContain(otherName)
          }
        }
      }
    }
  })

  test('the SAME verb is used for both directions — "Mover X", never "Mover" on one side and "Trazer" on the other', () => {
    const toBottom = panelMenuEntries({ panel: 'studio', placement: 'rail', lang: 'pt', panelName: 'Studio' })
      .find(e => e.id === 'move-bottom')!
    const toRight = panelMenuEntries({ panel: 'studio', placement: 'bottom', lang: 'pt', panelName: 'Studio' })
      .find(e => e.id === 'move-right')!
    expect(toBottom.label.startsWith('Mover')).toBe(true)
    expect(toRight.label.startsWith('Mover')).toBe(true)
    expect(toBottom.label).toBe('Mover Studio para baixo')
    expect(toRight.label).toBe('Mover Studio para a direita')
  })

  test('full screen is NEVER a row in this menu — it is a fixed button now, see `fullscreenModeFor`', () => {
    for (const panel of PANEL_IDS) {
      for (const placement of PLACEMENTS) {
        if (!allowed(placement, panel)) continue
        const entries = panelMenuEntries({ panel, placement, lang: 'en', panelName: panel })
        expect(names(entries)).not.toContain('fullscreen')
        expect(names(entries)).not.toContain('exit-fullscreen')
        for (const e of entries) expect(e.iconId === 'maximize' || e.iconId === 'minimize').toBe(false)
      }
    }
  })

  test('the Studio is the one panel that carries a generic close row, and it is always last', () => {
    for (const placement of PLACEMENTS) {
      const entries = panelMenuEntries({ panel: 'studio', placement, lang: 'pt', panelName: 'Studio' })
      expect(entries.at(-1)!.id).toBe('close')
      expect(entries.at(-1)!.label).toBe('Fechar Studio')
    }
  })

  test('every OTHER panel never carries a generic close row', () => {
    for (const panel of PANEL_IDS) {
      if (panel === 'studio') continue
      for (const placement of PLACEMENTS) {
        if (!allowed(placement, panel)) continue
        const entries = panelMenuEntries({ panel, placement, lang: 'en', panelName: panel })
        expect(names(entries)).not.toContain('close')
      }
    }
  })

  test('ICON DIRECTION — every row’s icon points at the DESTINATION, never at the panel’s current position', () => {
    const toRight = panelMenuEntries({ panel: 'shell', placement: 'bottom', lang: 'en', panelName: 'Shell' })
      .find(e => e.id === 'move-right')!
    expect(toRight.iconId).toBe('arrow-right')

    const toBottom = panelMenuEntries({ panel: 'shell', placement: 'rail', lang: 'en', panelName: 'Shell' })
      .find(e => e.id === 'move-bottom')!
    expect(toBottom.iconId).toBe('arrow-down')
  })

  test('no two entries in the same menu ever share an icon', () => {
    for (const panel of PANEL_IDS) {
      for (const placement of PLACEMENTS) {
        if (!allowed(placement, panel)) continue
        const entries = panelMenuEntries({ panel, placement, lang: 'en', panelName: panel })
        const icons = entries.map(e => e.iconId)
        expect(new Set(icons).size).toBe(icons.length)
      }
    }
  })
})

describe('fullscreenModeFor — what the fixed full-screen button does per panel', () => {
  test('cli and shell navigate to their existing dedicated screen', () => {
    expect(fullscreenModeFor('cli')).toBe('navigate')
    expect(fullscreenModeFor('shell')).toBe('navigate')
  })

  test('every other panel covers the viewport in place — no dedicated screen of its own', () => {
    for (const panel of PANEL_IDS) {
      if (panel === 'cli' || panel === 'shell') continue
      expect(fullscreenModeFor(panel)).toBe('overlay')
    }
  })

  test('every PANEL_IDS member resolves to one of the two modes — never a third answer', () => {
    for (const panel of PANEL_IDS) {
      expect(['overlay', 'navigate']).toContain(fullscreenModeFor(panel))
    }
  })
})

describe('panelMinimizeAction — what minimizing this panel, in this placement, actually does', () => {
  test('every allowed panel × placement pair DOES carry a minimize action', () => {
    for (const panel of PANEL_IDS) {
      for (const placement of PLACEMENTS) {
        if (!allowed(placement, panel)) continue
        expect(panelMinimizeAction(panel, placement)).not.toBeNull()
      }
    }
  })

  test('the bottom band always collapses in place, for every panel', () => {
    for (const panel of PANEL_IDS) {
      expect(panelMinimizeAction(panel, 'bottom')).toBe('collapse-bottom')
    }
  })

  test('the Studio, on the rail, PARKS — the one case with real client-only state to lose', () => {
    expect(panelMinimizeAction('studio', 'rail')).toBe('collapse-right-park')
  })

  test('every other rail panel closes outright — safe, since none holds unrecoverable state', () => {
    for (const panel of PANEL_IDS) {
      if (panel === 'studio') continue
      expect(panelMinimizeAction(panel, 'rail')).toBe('close-right')
    }
  })
})
