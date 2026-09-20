import { describe, expect, test } from 'bun:test'
import { allowed, PANEL_IDS, type PanelId, type SlotId } from './panelSlots'
import { fullscreenModeFor, panelMenuEntries, panelMinimizeAction, type PanelMenuEntry } from './panelMenu'

const SLOTS: readonly SlotId[] = ['right', 'bottom']

function names(entries: readonly PanelMenuEntry[]): string[] {
  return entries.map(e => e.id)
}

describe('panelMenuEntries — the one builder every placement menu goes through', () => {
  test('every panel now reaches both slots (2026-09-19), so every panel offers a move row from each', () => {
    for (const panel of PANEL_IDS) {
      const fromRight = panelMenuEntries({ panel, slot: 'right', lang: 'en', panelName: panel })
      expect(names(fromRight)).toContain('move-bottom')
      expect(names(fromRight)).not.toContain('move-right')

      const fromBottom = panelMenuEntries({ panel, slot: 'bottom', lang: 'en', panelName: panel })
      expect(names(fromBottom)).toContain('move-right')
      expect(names(fromBottom)).not.toContain('move-bottom')
    }
  })

  test('every entry names ONLY the panel this menu belongs to, never another one', () => {
    const other: Record<PanelId, string> = {
      contents: 'Conteúdo', studio: 'Studio', cli: 'Claude Code', shell: 'Shell', hardware: 'Hardware',
    }
    for (const panel of PANEL_IDS) {
      for (const slot of SLOTS) {
        if (!allowed(slot, panel)) continue
        for (const lang of ['pt', 'en'] as const) {
          const entries = panelMenuEntries({ panel, slot, lang, panelName: other[panel] })
          for (const entry of entries) {
            expect(entry.label).toContain(other[panel])
            for (const [otherPanel, otherName] of Object.entries(other)) {
              if (otherPanel === panel) continue
              expect(entry.label).not.toContain(otherName)
            }
          }
        }
      }
    }
  })

  test('the SAME verb is used for both directions — "Mover X", never "Mover" on one side and "Trazer" on the other', () => {
    const toBottom = panelMenuEntries({ panel: 'studio', slot: 'right', lang: 'pt', panelName: 'Studio' })
      .find(e => e.id === 'move-bottom')!
    const toRight = panelMenuEntries({ panel: 'studio', slot: 'bottom', lang: 'pt', panelName: 'Studio' })
      .find(e => e.id === 'move-right')!
    expect(toBottom.label.startsWith('Mover')).toBe(true)
    expect(toRight.label.startsWith('Mover')).toBe(true)
    expect(toBottom.label).toBe('Mover Studio para baixo')
    expect(toRight.label).toBe('Mover Studio para a direita')
  })

  test('full screen is NEVER a row in this menu (2026-09-19) — it is a fixed button now, see `fullscreenModeFor`', () => {
    for (const panel of PANEL_IDS) {
      for (const slot of SLOTS) {
        if (!allowed(slot, panel)) continue
        const entries = panelMenuEntries({ panel, slot, lang: 'en', panelName: panel })
        expect(names(entries)).not.toContain('fullscreen')
        expect(names(entries)).not.toContain('exit-fullscreen')
        // No entry ever resolves to the maximize/minimize glyphs either — those are reserved for
        // the fixed full-screen button now, never for a menu row.
        for (const e of entries) expect(e.iconId === 'maximize' || e.iconId === 'minimize').toBe(false)
      }
    }
  })

  test('the Studio is the one panel that carries a generic close row, and it is always last', () => {
    for (const slot of SLOTS) {
      const entries = panelMenuEntries({ panel: 'studio', slot, lang: 'pt', panelName: 'Studio' })
      expect(entries.at(-1)!.id).toBe('close')
      expect(entries.at(-1)!.label).toBe('Fechar Studio')
    }
  })

  test(
    'every OTHER panel never carries a generic close row — its always-visible minimize icon already ' +
    'closes it outright in the right slot, and closing it at the bottom has no visible effect ' +
    '(`bottomBandFor` always refills a local session\'s bottom band regardless)',
    () => {
      for (const panel of ['contents', 'cli', 'shell', 'hardware'] as const) {
        for (const slot of SLOTS) {
          if (!allowed(slot, panel)) continue
          const entries = panelMenuEntries({ panel, slot, lang: 'en', panelName: panel })
          expect(names(entries)).not.toContain('close')
        }
      }
    },
  )

  test(
    'ICON DIRECTION — every row\'s icon points at the DESTINATION, never at the panel\'s current ' +
    'position (owner, 2026-09-19: the old PanelRightOpen glyph pointed the opposite way from what ' +
    'its own row said)',
    () => {
      const toRight = panelMenuEntries({ panel: 'shell', slot: 'bottom', lang: 'en', panelName: 'Shell' })
        .find(e => e.id === 'move-right')!
      expect(toRight.iconId).toBe('arrow-right')

      const toBottom = panelMenuEntries({ panel: 'shell', slot: 'right', lang: 'en', panelName: 'Shell' })
        .find(e => e.id === 'move-bottom')!
      expect(toBottom.iconId).toBe('arrow-down')
    },
  )

  test('no two entries in the same menu ever share an icon', () => {
    for (const panel of PANEL_IDS) {
      for (const slot of SLOTS) {
        if (!allowed(slot, panel)) continue
        const entries = panelMenuEntries({ panel, slot, lang: 'en', panelName: panel })
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

  test('studio, contents and hardware cover the viewport in place — no dedicated screen of their own', () => {
    expect(fullscreenModeFor('studio')).toBe('overlay')
    expect(fullscreenModeFor('contents')).toBe('overlay')
    expect(fullscreenModeFor('hardware')).toBe('overlay')
  })

  test('every PANEL_IDS member resolves to one of the two modes — never a third answer', () => {
    for (const panel of PANEL_IDS) {
      expect(['overlay', 'navigate']).toContain(fullscreenModeFor(panel))
    }
  })
})

describe('panelMinimizeAction — what minimizing this panel, in this slot, actually does', () => {
  test('every allowed panel × slot pair DOES carry a minimize action — none is left silently absent', () => {
    for (const panel of PANEL_IDS) {
      for (const slot of SLOTS) {
        if (!allowed(slot, panel)) continue
        expect(panelMinimizeAction(panel, slot)).not.toBeNull()
      }
    }
  })

  test('the bottom band always collapses in place — every panel it can hold already parks, not unmounts', () => {
    for (const panel of PANEL_IDS) {
      expect(panelMinimizeAction(panel, 'bottom')).toBe('collapse-bottom')
    }
  })

  test('the Studio, at the right, PARKS — the one case with real client-only state to lose', () => {
    expect(panelMinimizeAction('studio', 'right')).toBe('collapse-right-park')
  })

  test('every other right-slot panel closes outright — safe, since none holds unrecoverable state', () => {
    expect(panelMinimizeAction('contents', 'right')).toBe('close-right')
    expect(panelMinimizeAction('hardware', 'right')).toBe('close-right')
    expect(panelMinimizeAction('cli', 'right')).toBe('close-right')
    expect(panelMinimizeAction('shell', 'right')).toBe('close-right')
  })
})
