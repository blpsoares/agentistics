import { describe, expect, test } from 'bun:test'
import { allowed, PANEL_IDS, type PanelId, type SlotId } from './panelSlots'
import { panelMenuEntries, panelMinimizeAction, type PanelMenuEntry } from './panelMenu'

const SLOTS: readonly SlotId[] = ['right', 'bottom']

function names(entries: readonly PanelMenuEntry[]): string[] {
  return entries.map(e => e.id)
}

describe('panelMenuEntries — the one builder every placement menu goes through', () => {
  test('a panel sitting at the right offers "move to the bottom" only when it can actually go there', () => {
    const studio = panelMenuEntries({
      panel: 'studio', slot: 'right', lang: 'en', panelName: 'Studio',
      fullscreenAvailable: false, fullscreen: false,
    })
    expect(names(studio)).toContain('move-bottom')
    expect(names(studio)).not.toContain('move-right')

    const contents = panelMenuEntries({
      panel: 'contents', slot: 'right', lang: 'en', panelName: 'Contents',
      fullscreenAvailable: false, fullscreen: false,
    })
    expect(names(contents)).not.toContain('move-bottom')
    expect(names(contents)).not.toContain('move-right')

    const hardware = panelMenuEntries({
      panel: 'hardware', slot: 'right', lang: 'en', panelName: 'Hardware',
      fullscreenAvailable: false, fullscreen: false,
    })
    expect(names(hardware)).not.toContain('move-bottom')
  })

  test('a panel sitting at the bottom offers "move to the right" — never a move to where it already is', () => {
    for (const panel of ['studio', 'cli', 'shell'] as const) {
      const entries = panelMenuEntries({
        panel, slot: 'bottom', lang: 'en', panelName: panel,
        fullscreenAvailable: false, fullscreen: false,
      })
      expect(names(entries)).toContain('move-right')
      expect(names(entries)).not.toContain('move-bottom')
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
          const entries = panelMenuEntries({
            panel, slot, lang, panelName: other[panel],
            fullscreenAvailable: panel === 'studio' && slot === 'bottom',
            fullscreen: false,
          })
          for (const entry of entries) {
            // Move and close name THIS panel explicitly; full screen names no panel at all (it is
            // unambiguous from context) — so only the entries that carry a name are checked for it.
            if (entry.id === 'move-right' || entry.id === 'move-bottom' || entry.id === 'close') {
              expect(entry.label).toContain(other[panel])
            }
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
    const toBottom = panelMenuEntries({
      panel: 'studio', slot: 'right', lang: 'pt', panelName: 'Studio',
      fullscreenAvailable: false, fullscreen: false,
    }).find(e => e.id === 'move-bottom')!
    const toRight = panelMenuEntries({
      panel: 'studio', slot: 'bottom', lang: 'pt', panelName: 'Studio',
      fullscreenAvailable: false, fullscreen: false,
    }).find(e => e.id === 'move-right')!
    expect(toBottom.label.startsWith('Mover')).toBe(true)
    expect(toRight.label.startsWith('Mover')).toBe(true)
    expect(toBottom.label).toBe('Mover Studio para baixo')
    expect(toRight.label).toBe('Mover Studio para a direita')
  })

  test('fullscreen is absent unless the caller explicitly offers it — never present and refusing', () => {
    const entries = panelMenuEntries({
      panel: 'studio', slot: 'right', lang: 'en', panelName: 'Studio',
      fullscreenAvailable: false, fullscreen: false,
    })
    expect(names(entries)).not.toContain('fullscreen')
    expect(names(entries)).not.toContain('exit-fullscreen')
  })

  test('fullscreen toggles its own row and icon without ever offering both at once', () => {
    const off = panelMenuEntries({
      panel: 'studio', slot: 'bottom', lang: 'en', panelName: 'Studio',
      fullscreenAvailable: true, fullscreen: false,
    })
    expect(names(off)).toContain('fullscreen')
    expect(names(off)).not.toContain('exit-fullscreen')
    expect(off.find(e => e.id === 'fullscreen')!.iconId).toBe('maximize')

    const on = panelMenuEntries({
      panel: 'studio', slot: 'bottom', lang: 'en', panelName: 'Studio',
      fullscreenAvailable: true, fullscreen: true,
    })
    expect(names(on)).toContain('exit-fullscreen')
    expect(names(on)).not.toContain('fullscreen')
    expect(on.find(e => e.id === 'exit-fullscreen')!.iconId).toBe('minimize')
  })

  test('the Studio is the one panel that carries a generic close row, and it is always last', () => {
    for (const slot of SLOTS) {
      const entries = panelMenuEntries({
        panel: 'studio', slot, lang: 'pt', panelName: 'Studio',
        fullscreenAvailable: false, fullscreen: false,
      })
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
          const entries = panelMenuEntries({
            panel, slot, lang: 'en', panelName: panel,
            fullscreenAvailable: false, fullscreen: false,
          })
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
      const toRight = panelMenuEntries({
        panel: 'shell', slot: 'bottom', lang: 'en', panelName: 'Shell',
        fullscreenAvailable: false, fullscreen: false,
      }).find(e => e.id === 'move-right')!
      expect(toRight.iconId).toBe('arrow-right')

      const toBottom = panelMenuEntries({
        panel: 'shell', slot: 'right', lang: 'en', panelName: 'Shell',
        fullscreenAvailable: false, fullscreen: false,
      }).find(e => e.id === 'move-bottom')!
      expect(toBottom.iconId).toBe('arrow-down')
    },
  )

  test('full screen never reuses a move icon, and its own pair never disagrees with itself', () => {
    for (const panel of PANEL_IDS) {
      for (const slot of SLOTS) {
        if (!allowed(slot, panel)) continue
        const entries = panelMenuEntries({
          panel, slot, lang: 'en', panelName: panel,
          fullscreenAvailable: true, fullscreen: false,
        })
        const icons = entries.map(e => e.iconId)
        // No two entries in the SAME menu may share an icon — an icon that means two things in one
        // menu is exactly the ambiguity this builder exists to remove.
        expect(new Set(icons).size).toBe(icons.length)
      }
    }
  })
})

describe('panelMinimizeAction — what minimizing this panel, in this slot, actually does', () => {
  test('a panel that cannot even sit in a slot has no minimize action there', () => {
    expect(panelMinimizeAction('contents', 'bottom')).toBeNull()
    expect(panelMinimizeAction('hardware', 'bottom')).toBeNull()
  })

  test('every allowed panel × slot pair DOES carry a minimize action — none is left silently absent', () => {
    for (const panel of PANEL_IDS) {
      for (const slot of SLOTS) {
        if (!allowed(slot, panel)) continue
        expect(panelMinimizeAction(panel, slot)).not.toBeNull()
      }
    }
  })

  test('the bottom band always collapses in place — every panel it can hold already parks, not unmounts', () => {
    for (const panel of ['studio', 'cli', 'shell'] as const) {
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
