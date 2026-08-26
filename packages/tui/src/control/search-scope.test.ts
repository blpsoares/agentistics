import { describe, expect, test } from 'bun:test'
import {
  activeScopes, allState, DEFAULT_SCOPE_SELECTION, emptyScopeCounts, matchScopes, normalizeSelection,
  scopeCounts, searchDepthText, toggleAllScopes, toggleScope, transcriptScopeOn,
  type SearchFields, type SearchScopeSelection,
} from './search-scope'

const fields = (o: Partial<SearchFields> = {}): SearchFields => ({
  name: '', folder: '', harness: '', note: '', task: '', prompt: '', ...o,
})

describe('matchScopes', () => {
  test('names the field the query was found in, not merely that it matched', () => {
    const got = matchScopes(fields({ name: 'agentistics', folder: '/home/x/proj' }), 'agent')
    expect(got).toEqual(['name'])
  })

  test('reports EVERY field that carries the query, so a row can say it matched twice', () => {
    const got = matchScopes(fields({ name: 'docker', prompt: 'fix the docker build' }), 'docker')
    expect(got).toEqual(['name', 'prompt'])
  })

  test('an empty query matches nothing — it is not a wildcard', () => {
    expect(matchScopes(fields({ name: 'anything' }), '')).toEqual([])
    expect(matchScopes(fields({ name: 'anything' }), '   ')).toEqual([])
  })

  test('matching ignores case and surrounding whitespace in the query', () => {
    expect(matchScopes(fields({ name: 'Agentistics' }), '  AGENT  ')).toEqual(['name'])
  })

  test('a transcript hit is a scope like any other, supplied by the caller', () => {
    expect(matchScopes(fields(), 'docker', { transcript: true })).toEqual(['transcript'])
  })

  test('transcript never matches when the caller did not find one', () => {
    expect(matchScopes(fields(), 'docker', { transcript: false })).toEqual([])
  })

  test('scopes come back in a fixed reading order regardless of which matched', () => {
    const got = matchScopes(
      fields({ task: 'release', prompt: 'release notes', name: 'release' }),
      'release',
      { transcript: true },
    )
    expect(got).toEqual(['name', 'task', 'prompt', 'transcript'])
  })
})

describe('scopeCounts', () => {
  test('counts how many rows carry the query in each scope', () => {
    const rows = [
      { fields: fields({ name: 'docker' }), transcript: false },
      { fields: fields({ prompt: 'docker compose' }), transcript: false },
      { fields: fields({ prompt: 'docker build' }), transcript: true },
    ]
    expect(scopeCounts(rows, 'docker')).toEqual({
      name: 1, folder: 0, harness: 0, note: 0, task: 0, prompt: 2, transcript: 1,
    })
  })

  test('a scope nothing matched is a real zero, present in the record', () => {
    const rows = [{ fields: fields({ name: 'x' }), transcript: false }]
    expect(scopeCounts(rows, 'zzz').name).toBe(0)
  })
})

// ---------------------------------------------------------------------------

const words = {
  scope: {
    name: 'name', folder: 'folder', harness: 'harness',
    note: 'note', task: 'task', prompt: 'prompt', transcript: 'transcript',
  },
  noGrep: 'no grep here',
  noTranscripts: 'none on this machine',
  transcriptOff: 'transcript off',
}

describe('searchDepthText', () => {
  test('lists the scopes that matched, with their counts', () => {
    const counts = { ...emptyScopeCounts(), name: 3, prompt: 5, transcript: 47 }
    expect(searchDepthText(counts, words, {})).toBe('name 3 · prompt 5 · transcript 47')
  })

  test('a scope nothing matched is left out — it would be noise on every search', () => {
    const counts = { ...emptyScopeCounts(), name: 3 }
    expect(searchDepthText(counts, words, {})).toBe('name 3 · transcript 0')
  })

  test('TRANSCRIPT is always stated, even at zero — it is the one that might not have run', () => {
    expect(searchDepthText(emptyScopeCounts(), words, {})).toBe('transcript 0')
  })

  test('a transcription depth switched OFF says so, distinct from "none on this machine"', () => {
    const counts = { ...emptyScopeCounts(), name: 2 }
    expect(searchDepthText(counts, words, { off: true })).toBe('name 2 · transcript off')
    // …and it outranks a stale running/unavailable flag: nothing ran, so nothing is pending.
    expect(searchDepthText(counts, words, { off: true, running: true, runningWord: 'reading…' }))
      .toBe('name 2 · transcript off')
  })

  test('an unsearchable transcript says WHY instead of showing a zero', () => {
    const counts = { ...emptyScopeCounts(), name: 2 }
    expect(searchDepthText(counts, words, { unavailable: 'no-grep' }))
      .toBe('name 2 · no grep here')
    expect(searchDepthText(counts, words, { unavailable: 'no-transcripts' }))
      .toBe('name 2 · none on this machine')
  })

  test('while the transcript search is still running it says so rather than reporting 0', () => {
    const counts = { ...emptyScopeCounts(), name: 2 }
    expect(searchDepthText(counts, words, { running: true, runningWord: 'reading…' }))
      .toBe('name 2 · reading…')
  })
})

// ---------------------------------------------------------------------------
// Selectable, cumulative search depth + the two-way "all" — finding (3).

const sel = (o: Partial<SearchScopeSelection> = {}): SearchScopeSelection =>
  ({ ...DEFAULT_SCOPE_SELECTION, ...o })

describe('scope selection defaults', () => {
  test('title and first prompt on, transcription OFF — the disk read is opt-in', () => {
    expect(DEFAULT_SCOPE_SELECTION).toEqual({ title: true, prompt: true, transcript: false })
  })

  test('a stored selection missing a key reads as that key’s default, never as false', () => {
    expect(normalizeSelection(undefined)).toEqual(DEFAULT_SCOPE_SELECTION)
    expect(normalizeSelection({ transcript: true })).toEqual({ title: true, prompt: true, transcript: true })
    expect(normalizeSelection({ title: false })).toEqual({ title: false, prompt: true, transcript: false })
  })
})

describe('activeScopes', () => {
  test('the structured scopes are always searched, whatever the toggles say', () => {
    const off = activeScopes({ title: false, prompt: false, transcript: false })
    for (const s of ['folder', 'harness', 'note', 'task'] as const) expect(off.has(s)).toBe(true)
    // …and the three human depths are all off.
    expect(off.has('name')).toBe(false)
    expect(off.has('prompt')).toBe(false)
    expect(off.has('transcript')).toBe(false)
  })

  test('each toggle turns on exactly its own scope — cumulative, several at once', () => {
    expect(activeScopes(sel({ transcript: true })).has('transcript')).toBe(true)
    const titleOnly = activeScopes({ title: true, prompt: false, transcript: false })
    expect(titleOnly.has('name')).toBe(true)
    expect(titleOnly.has('prompt')).toBe(false)
  })

  test('transcriptScopeOn is the single gate for the expensive disk search', () => {
    expect(transcriptScopeOn(sel({ transcript: false }))).toBe(false)
    expect(transcriptScopeOn(sel({ transcript: true }))).toBe(true)
  })
})

describe('the "all" control is two-way and never contradicts the individuals', () => {
  test('all shows ON exactly when every individual is checked', () => {
    expect(allState({ title: true, prompt: true, transcript: true })).toBe('on')
  })
  test('all shows OFF when none is, and MIXED when some are', () => {
    expect(allState({ title: false, prompt: false, transcript: false })).toBe('off')
    expect(allState({ title: true, prompt: false, transcript: false })).toBe('mixed')
    expect(allState(DEFAULT_SCOPE_SELECTION)).toBe('mixed')
  })
  test('checking all from mixed turns every individual on; from all-on it clears them', () => {
    expect(toggleAllScopes({ title: true, prompt: false, transcript: false }))
      .toEqual({ title: true, prompt: true, transcript: true })
    expect(toggleAllScopes({ title: true, prompt: true, transcript: true }))
      .toEqual({ title: false, prompt: false, transcript: false })
    expect(toggleAllScopes({ title: false, prompt: false, transcript: false }))
      .toEqual({ title: true, prompt: true, transcript: true })
  })
  test('turning the last individual on makes all read ON — the reverse direction, by derivation', () => {
    const oneOff = { title: true, prompt: true, transcript: false }
    expect(allState(oneOff)).toBe('mixed')
    expect(allState(toggleScope(oneOff, 'transcript'))).toBe('on')
  })
})

describe('matchScopes honours the active selection', () => {
  const active = (s: SearchScopeSelection) => activeScopes(s)

  test('a title-only match is invisible while the title toggle is off', () => {
    const row = fields({ name: 'docker' })
    expect(matchScopes(row, 'docker', {}, active(sel({ title: true })))).toEqual(['name'])
    expect(matchScopes(row, 'docker', {}, active(sel({ title: false })))).toEqual([])
  })

  test('a transcript hit is dropped unless the transcription toggle is on — the perf guard', () => {
    const row = fields()
    expect(matchScopes(row, 'docker', { transcript: true }, active(sel({ transcript: false })))).toEqual([])
    expect(matchScopes(row, 'docker', { transcript: true }, active(sel({ transcript: true })))).toEqual(['transcript'])
  })

  test('the always-on structured scopes still match with every toggle off', () => {
    const row = fields({ note: 'docker note', task: 'docker task' })
    const allOff = active({ title: false, prompt: false, transcript: false })
    expect(matchScopes(row, 'docker', {}, allOff)).toEqual(['note', 'task'])
  })

  test('with no active set given, behaviour is unchanged — every scope is searched', () => {
    const row = fields({ name: 'docker', prompt: 'docker build' })
    expect(matchScopes(row, 'docker')).toEqual(['name', 'prompt'])
  })

  test('scopeCounts respects the active set too, so the depth line cannot exceed what was searched', () => {
    const rows = [{ fields: fields({ name: 'docker' }), transcript: true }]
    const counts = scopeCounts(rows, 'docker', activeScopes(sel({ title: false, transcript: false })))
    expect(counts.name).toBe(0)
    expect(counts.transcript).toBe(0)
  })
})
