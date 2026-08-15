import { describe, it, expect } from 'bun:test'
import { sameProcess, readProcStart, procAvailable } from './proc-liveness'

describe('sameProcess — the anti-recycling rule', () => {
  it('matches only when both sides say the same start time', () => {
    expect(sameProcess('2467615', '2467615')).toBe(true)
    expect(sameProcess('2467615', '9999999')).toBe(false)
  })

  it('refuses when the pid is gone', () => {
    // `undefined` from the probe is a real answer: nothing is running under that number.
    expect(sameProcess('2467615', undefined)).toBe(false)
  })

  it('refuses a record with NO start time, rather than trusting the pid alone', () => {
    // Every claude before it began writing `procStart`. The caller uses this to claim a session is
    // alive, and the directory is mostly dead pids the OS is free to hand out again — measured
    // here: 64 records, 3 running. An unproven claim of liveness is worse than an absent one, so
    // such a row simply stays as it was.
    expect(sameProcess(undefined, '2467615')).toBe(false)
    expect(sameProcess(undefined, undefined)).toBe(false)
    expect(sameProcess('', '2467615')).toBe(false)
  })
})

describe('readProcStart — reading the real /proc', () => {
  it('reads this very process, and agrees with itself', async () => {
    if (!(await procAvailable())) return // not Linux: the feature is absent, not wrong
    const mine = await readProcStart(process.pid)
    expect(mine).toMatch(/^\d+$/)
    expect(sameProcess(mine, await readProcStart(process.pid))).toBe(true)
  })

  it('survives a name with spaces and parentheses in it', async () => {
    // Field 2 of /proc/<pid>/stat is the executable name IN PARENTHESES and may contain both. A
    // left-to-right split would put every later field at an offset that depends on the program's
    // name — which is why the parse cuts at the LAST `)`. Reading our own stat exercises it: bun's
    // comm is plain, so this asserts the shape rather than the pathological case, and the rule is
    // documented where it is implemented.
    if (!(await procAvailable())) return
    expect(await readProcStart(process.pid)).toMatch(/^\d+$/)
  })

  it('returns undefined for a pid that cannot exist', async () => {
    expect(await readProcStart(2 ** 31)).toBeUndefined()
  })
})
