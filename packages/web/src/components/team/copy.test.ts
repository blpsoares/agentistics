import { describe, test, expect } from 'bun:test'
import { COPY, PLURAL_COPY, plural, interpolate } from './copy'

/** Every `{word}` placeholder token found in a string, deduped. */
function placeholders(s: string): Set<string> {
  return new Set([...s.matchAll(/\{(\w+)\}/g)].map(m => m[1] ?? ''))
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

describe('COPY — plain rows', () => {
  const rows = Object.entries(COPY)

  test('has at least one row', () => {
    expect(rows.length).toBeGreaterThan(0)
  })

  test('every en key exists in pt and vice versa', () => {
    for (const [, entry] of rows) {
      expect(entry).toHaveProperty('en')
      expect(entry).toHaveProperty('pt')
    }
  })

  test('no row has an empty en or pt string', () => {
    let checked = 0
    for (const [, entry] of rows) {
      expect(entry.en.length).toBeGreaterThan(0)
      expect(entry.pt.length).toBeGreaterThan(0)
      checked++
    }
    expect(checked).toBe(rows.length)
  })

  test('placeholder parity: the {…} tokens in en match those in pt, for every row', () => {
    let checked = 0
    for (const [, entry] of rows) {
      const enPh = placeholders(entry.en)
      const ptPh = placeholders(entry.pt)
      expect(sameSet(enPh, ptPh)).toBe(true)
      checked++
    }
    expect(checked).toBe(rows.length)
  })
})

describe('PLURAL_COPY — {one, other} rows', () => {
  const rows = Object.entries(PLURAL_COPY)

  test('has at least one row', () => {
    expect(rows.length).toBeGreaterThan(0)
  })

  test('every row has one and other in both languages, all non-empty', () => {
    let checked = 0
    for (const [, entry] of rows) {
      expect(entry.en.one.length).toBeGreaterThan(0)
      expect(entry.en.other.length).toBeGreaterThan(0)
      expect(entry.pt.one.length).toBeGreaterThan(0)
      expect(entry.pt.other.length).toBeGreaterThan(0)
      checked++
    }
    expect(checked).toBe(rows.length)
  })

  test('placeholder parity holds for the one form and for the other form independently', () => {
    let checked = 0
    for (const [, entry] of rows) {
      expect(sameSet(placeholders(entry.en.one), placeholders(entry.pt.one))).toBe(true)
      expect(sameSet(placeholders(entry.en.other), placeholders(entry.pt.other))).toBe(true)
      checked++
    }
    expect(checked).toBe(rows.length)
  })
})

describe('plural()', () => {
  const entry = { one: 'one thing', other: 'many things' }

  test('picks one at n === 1', () => {
    expect(plural(entry, 1)).toBe('one thing')
  })

  test('picks other at n === 0', () => {
    expect(plural(entry, 0)).toBe('many things')
  })

  test('picks other at n === 2', () => {
    expect(plural(entry, 2)).toBe('many things')
  })
})

describe('interpolate()', () => {
  test('substitutes a single placeholder', () => {
    expect(interpolate('last sync {t}', { t: '2m ago' })).toBe('last sync 2m ago')
  })

  test('substitutes multiple distinct placeholders', () => {
    expect(interpolate('Removes {sessions} sessions (~{cost}) from this central.', { sessions: 12, cost: '$0.40' }))
      .toBe('Removes 12 sessions (~$0.40) from this central.')
  })

  test('leaves an unmatched placeholder untouched rather than throwing', () => {
    expect(interpolate('{known} and {unknown}', { known: 'x' })).toBe('x and {unknown}')
  })
})

describe('the apply-success banner (review fix Important 4)', () => {
  test('states no session count — a confirmation for a privacy action never invents a number', () => {
    // It used to render `plural(PLURAL_COPY.applyOk, 1)`, i.e. "Rules applied — 1 session re-sent"
    // for every apply regardless of what happened. Neither number the client holds means "sessions
    // re-sent" (`resync.total` is the forget count; `impact.sessions` is a pre-submit estimate) and
    // on the no-resync path there is no number at all — so the copy states none.
    expect(COPY.applyOk.en).not.toMatch(/\{n\}|\d/)
    expect(COPY.applyOk.pt).not.toMatch(/\{n\}|\d/)
    expect(Object.keys(PLURAL_COPY)).not.toContain('applyOk')
  })
})

describe('Plan 4 Task 1, fix 2 — the confirm copy is rewritten in plain language but drops no fact', () => {
  test('applyConfirmBody still states that already-sent data has been seen by the central operator', () => {
    expect(COPY.applyConfirmBody.en.toLowerCase()).toContain('seen')
    expect(COPY.applyConfirmBody.pt.toLowerCase()).toContain('visto')
  })

  test('applyConfirmStats still states the pre-boundary aggregate cannot be split by repository', () => {
    expect(COPY.applyConfirmStats.en.toLowerCase()).toMatch(/split/)
    expect(COPY.applyConfirmStats.pt.toLowerCase()).toMatch(/separad/)
  })

  test('statsNote still states the same pre-boundary limitation shown in the read view', () => {
    expect(COPY.statsNote.en.toLowerCase()).toMatch(/split/)
    expect(COPY.statsNote.pt.toLowerCase()).toMatch(/separ/)
  })
})

describe('Plan 4 Task 1, fix 1 — the hidden-block heading is explicit and carries its own count', () => {
  test('hiddenBlockTitle names "hidden"/"oculto" explicitly, with a {n} placeholder for the count', () => {
    expect(COPY.hiddenBlockTitle.en.toLowerCase()).toContain('hidden')
    expect(COPY.hiddenBlockTitle.pt.toLowerCase()).toContain('ocult')
    expect(COPY.hiddenBlockTitle.en).toContain('{n}')
    expect(COPY.hiddenBlockTitle.pt).toContain('{n}')
  })
})

describe('Plan 4 Task 1, fix 4 — "no repository" names what it actually covers', () => {
  test('noRepoSub names the CLIs that record no remote, not just "a CLI"', () => {
    for (const name of ['Codex', 'Gemini', 'Kimi']) {
      expect(COPY.noRepoSub.en).toContain(name)
      expect(COPY.noRepoSub.pt).toContain(name)
    }
  })
})

describe('Plan 4 Task 7 — the mode-switch confirm copy differs per direction', () => {
  test('toAllowlist and toDenylist confirm copy are different sentences, in both languages', () => {
    expect(COPY.modeConfirmToAllowlist.en).not.toBe(COPY.modeConfirmToDenylist.en)
    expect(COPY.modeConfirmToAllowlist.pt).not.toBe(COPY.modeConfirmToDenylist.pt)
  })

  test('the switch-to-allowlist copy states the consequence: hides what is not listed', () => {
    expect(COPY.modeConfirmToAllowlist.en.toLowerCase()).toMatch(/hides|hidden/)
    expect(COPY.modeConfirmToAllowlist.pt.toLowerCase()).toMatch(/oculta|ocult/)
  })

  test('an empty allowlist is refused with an explanation, never silently saved', () => {
    expect(COPY.emptyAllowlistWarning.en.length).toBeGreaterThan(0)
    expect(COPY.emptyAllowlistWarning.pt.length).toBeGreaterThan(0)
  })
})

describe('Plan 4 Task 1, fix 6 — the machine name is distinct from the local nickname', () => {
  test('identityMachineName exists and is distinct wording from the account/user row', () => {
    expect(COPY.identityMachineName.en.toLowerCase()).toContain('machine')
    expect(COPY.identityMachineName.pt.toLowerCase()).toContain('máquina')
  })

  test('nicknameHint states the nickname is local-only, never seen by the central', () => {
    expect(COPY.nicknameHint.en.toLowerCase()).toMatch(/only you|nickname/)
    expect(COPY.nicknameHint.pt.toLowerCase()).toMatch(/só você|apelido/)
  })
})
