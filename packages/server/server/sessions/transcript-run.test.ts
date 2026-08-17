import { describe, expect, test } from 'bun:test'
import { runTranscriptSearch, type TranscriptDeps } from './transcript-run'

const deps = (o: Partial<TranscriptDeps> = {}): TranscriptDeps => ({
  hasGrep: async () => true,
  dirExists: async () => true,
  grep: async () => '',
  ...o,
})

describe('runTranscriptSearch', () => {
  test('reports the conversations grep named, across the harnesses it walked', async () => {
    const got = await runTranscriptSearch('docker', deps({
      dirExists: async root => root.includes('projects'),
      grep: async () => '/x/projects/-p/aaaaaaaa-1111-2222-3333-444444444444.jsonl\0',
    }), { claude: { root: '/x/projects', include: '*.jsonl' } })

    expect([...got.ids]).toEqual(['aaaaaaaa-1111-2222-3333-444444444444'])
    expect(got.covered).toEqual(['claude'])
    expect(got.unavailable).toBeUndefined()
  })

  test('WITHOUT grep it says so — it never reports zero matches it did not look for', async () => {
    const got = await runTranscriptSearch('docker', deps({ hasGrep: async () => false }), {
      claude: { root: '/x/projects', include: '*.jsonl' },
    })

    expect(got.unavailable).toBe('no-grep')
    expect(got.ids.size).toBe(0)
    expect(got.covered).toEqual([])
  })

  test('with no transcript directory on this machine it says THAT, distinctly', async () => {
    const got = await runTranscriptSearch('docker', deps({ dirExists: async () => false }), {
      claude: { root: '/x/projects', include: '*.jsonl' },
    })

    expect(got.unavailable).toBe('no-transcripts')
    expect(got.covered).toEqual([])
  })

  test('a harness whose directory is absent is simply not claimed as covered', async () => {
    const got = await runTranscriptSearch('docker', deps({
      dirExists: async root => root === '/has',
      grep: async () => '/has/-p/aaaaaaaa-1111-2222-3333-444444444444.jsonl\0',
    }), {
      claude: { root: '/has', include: '*.jsonl' },
      codex: { root: '/missing', include: 'rollout-*.jsonl' },
    })

    expect(got.covered).toEqual(['claude'])
  })

  test('one harness failing does not lose the results of the others', async () => {
    const got = await runTranscriptSearch('docker', deps({
      grep: async (_q, root) => {
        if (root === '/boom') throw new Error('grep died')
        return '/ok/-p/aaaaaaaa-1111-2222-3333-444444444444.jsonl\0'
      },
    }), {
      claude: { root: '/ok', include: '*.jsonl' },
      codex: { root: '/boom', include: 'rollout-*.jsonl' },
    })

    expect([...got.ids]).toEqual(['aaaaaaaa-1111-2222-3333-444444444444'])
    expect(got.covered).toEqual(['claude'])
    expect(got.failed).toEqual(['codex'])
  })

  test('an empty query never touches the disk', async () => {
    let called = false
    const got = await runTranscriptSearch('   ', deps({ grep: async () => { called = true; return '' } }), {
      claude: { root: '/x', include: '*.jsonl' },
    })

    expect(called).toBe(false)
    expect(got.ids.size).toBe(0)
    expect(got.unavailable).toBeUndefined()
  })

  test('the query reaches grep unchanged — it is never escaped or rewritten', async () => {
    let seen = ''
    await runTranscriptSearch('; rm -rf /', deps({ grep: async q => { seen = q; return '' } }), {
      claude: { root: '/x', include: '*.jsonl' },
    })

    expect(seen).toBe('; rm -rf /')
  })
})
