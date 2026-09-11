import { beforeEach, expect, test } from 'bun:test'
import { resetResumeLocks, withResumeLock } from './resume-lock'

beforeEach(() => { resetResumeLocks() })

const defer = () => {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}

test('a second resume for the same conversation waits for the first to finish', async () => {
  const order: string[] = []
  const gate = defer()

  const first = withResumeLock('conv-1', async () => {
    order.push('first:start')
    await gate.promise
    order.push('first:end')
  })
  const second = withResumeLock('conv-1', async () => { order.push('second') })

  // The chain runs on a microtask, so let the first one actually start before looking.
  await Promise.resolve()
  // The second must not run while the first is still checking-and-spawning — that overlap is
  // exactly what let two `claude --resume` processes land for the same conversation.
  expect(order).toEqual(['first:start'])
  gate.resolve()
  await Promise.all([first, second])
  expect(order).toEqual(['first:start', 'first:end', 'second'])
})

test('two different conversations do not wait on each other', async () => {
  const order: string[] = []
  const gate = defer()

  const a = withResumeLock('conv-a', async () => { await gate.promise; order.push('a') })
  const b = withResumeLock('conv-b', async () => { order.push('b') })

  await b
  expect(order).toEqual(['b'])
  gate.resolve()
  await a
})

test('a failed resume does not wedge the lock forever', async () => {
  await expect(withResumeLock('conv-1', async () => { throw new Error('spawn failed') })).rejects.toThrow('spawn failed')
  expect(await withResumeLock('conv-1', async () => 'through')).toBe('through')
})

test('the caller still sees a rejection, it is only the chain that is protected', async () => {
  const boom = withResumeLock('conv-2', async () => { throw new Error('nope') })
  await expect(boom).rejects.toThrow('nope')
})
