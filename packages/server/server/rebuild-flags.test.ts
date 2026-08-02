import { describe, expect, test } from 'bun:test'
import {
  parseRebuildFlags,
  centralUpArgs,
  centralRebuildArgs,
  rebuildFlags,
  composeRebuildCommands,
} from './rebuild-flags'

describe('parseRebuildFlags', () => {
  test('answers nothing when nothing was asked', () => {
    const r = parseRebuildFlags([])
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    expect(r.flags).toEqual({})
    expect(r.rest).toEqual([])
  })

  test('reads the setup answer in both forms', () => {
    for (const [argv, setup] of [
      [['-y'], 'yes'],
      [['--yes'], 'yes'],
      [['-n'], 'no'],
      [['--no'], 'no'],
    ] as const) {
      const r = parseRebuildFlags(argv)
      expect(r.ok).toBe(true)
      if (!r.ok) throw new Error('unreachable')
      expect(r.flags.setup).toBe(setup)
    }
  })

  test('reads the cache choice in both directions', () => {
    const fresh = parseRebuildFlags(['--no-cache'])
    const reuse = parseRebuildFlags(['--cache'])
    expect(fresh.ok && fresh.flags.cache).toBe('fresh')
    expect(reuse.ok && reuse.flags.cache).toBe('reuse')
  })

  test('repeating the SAME answer is not a conflict', () => {
    const r = parseRebuildFlags(['-y', '--yes'])
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    expect(r.flags.setup).toBe('yes')
  })

  test('-y and -n together is a user error, naming both', () => {
    const r = parseRebuildFlags(['-y', '-n'])
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.conflict).toEqual(['-y', '-n'])
  })

  test('--cache and --no-cache together is a user error, naming both', () => {
    const r = parseRebuildFlags(['--cache', '--no-cache'])
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.conflict).toEqual(['--cache', '--no-cache'])
  })

  test('anything else is passed through, in order', () => {
    const r = parseRebuildFlags(['--email', 'a@b.c', '-y', 'extra'])
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    expect(r.rest).toEqual(['--email', 'a@b.c', 'extra'])
    expect(r.flags.setup).toBe('yes')
  })
})

describe('centralUpArgs', () => {
  test('emits ONLY what was actually asked for', () => {
    expect(centralUpArgs({})).toEqual([])
    expect(centralUpArgs({ setup: 'yes' })).toEqual(['--yes'])
    expect(centralUpArgs({ cache: 'reuse' })).toEqual(['--cache'])
    expect(centralUpArgs({ setup: 'no', cache: 'fresh' })).toEqual(['--no', '--no-cache'])
  })
})

describe('rebuildFlags', () => {
  test('a rebuild defaults to a cacheless build', () => {
    expect(rebuildFlags({}).cache).toBe('fresh')
    expect(rebuildFlags({ setup: 'no' })).toEqual({ setup: 'no', cache: 'fresh' })
  })

  test('an explicit --cache survives the default', () => {
    expect(rebuildFlags({ cache: 'reuse' }).cache).toBe('reuse')
  })
})

describe('centralRebuildArgs', () => {
  test('a streamed rebuild answers the prompt EXPLICITLY — it has no terminal to ask on', () => {
    expect(centralRebuildArgs({}, { streamed: true })).toEqual(['--no', '--no-cache'])
  })

  test('on a real terminal an unasked question is still the user’s to answer', () => {
    expect(centralRebuildArgs({})).toEqual(['--no-cache'])
  })

  test('what the user said wins over the streamed default', () => {
    expect(centralRebuildArgs({ setup: 'yes' }, { streamed: true })).toEqual(['--yes', '--no-cache'])
    expect(centralRebuildArgs({ cache: 'reuse' }, { streamed: true })).toEqual(['--no', '--cache'])
  })
})

describe('composeRebuildCommands', () => {
  test('a cacheless rebuild builds first, then recreates', () => {
    expect(composeRebuildCommands('/x/dc.yml', { cache: 'fresh' })).toEqual([
      ['docker', 'compose', '-f', '/x/dc.yml', 'build', '--no-cache'],
      ['docker', 'compose', '-f', '/x/dc.yml', 'up', '-d', '--force-recreate'],
    ])
  })

  test('reusing the cache stays the single up --build it always was', () => {
    expect(composeRebuildCommands('/x/dc.yml', { cache: 'reuse' })).toEqual([
      ['docker', 'compose', '-f', '/x/dc.yml', 'up', '-d', '--build'],
    ])
  })

  test('unspecified means fresh — a rebuild is a rebuild', () => {
    expect(composeRebuildCommands('/x/dc.yml', {})).toEqual(
      composeRebuildCommands('/x/dc.yml', { cache: 'fresh' }),
    )
  })
})
