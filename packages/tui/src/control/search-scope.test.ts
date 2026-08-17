import { describe, expect, test } from 'bun:test'
import {
  emptyScopeCounts, matchScopes, scopeCounts, searchDepthText, type SearchFields,
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
