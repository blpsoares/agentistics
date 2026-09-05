import { expect, test } from 'bun:test'
import { stableAttention } from './attention-stable'

test('a first sighting is shown at once — there is nothing to flap against', () => {
  expect(stableAttention({ observed: 'working' })).toEqual({ state: 'working' })
})

test('a change is held until the next poll agrees', () => {
  const first = stableAttention({ observed: 'working', shown: 'waiting' })
  expect(first.state).toBe('waiting')
  expect(first.pending).toEqual({ state: 'working' })
  const second = stableAttention({ observed: 'working', shown: 'waiting', pending: first.pending })
  expect(second.state).toBe('working')
})

test('a ONE-POLL flicker never reaches the row', () => {
  // The reported shape: a repaint flips the row for a single poll and it goes back.
  let shown = 'waiting' as const
  let pending
  for (const observed of ['working', 'waiting', 'working', 'waiting'] as const) {
    const r = stableAttention({ observed, shown, pending })
    pending = r.pending
    expect(r.state).toBe('waiting')
  }
  void shown
})

test('waiting-approval is applied IMMEDIATELY — a person is being asked something', () => {
  // Delaying a real block by a poll to smooth a colour is the wrong trade.
  expect(stableAttention({ observed: 'waiting-approval', shown: 'working' }))
    .toEqual({ state: 'waiting-approval' })
})

test('exited is applied immediately — there is nothing to confirm', () => {
  expect(stableAttention({ observed: 'exited', shown: 'working' })).toEqual({ state: 'exited' })
})

test('a sustained change still lands on the second poll, not later', () => {
  const a = stableAttention({ observed: 'working', shown: 'waiting' })
  const b = stableAttention({ observed: 'working', shown: 'waiting', pending: a.pending })
  expect(b.state).toBe('working')
  // …and stays, with nothing pending.
  const c = stableAttention({ observed: 'working', shown: 'working', pending: b.pending })
  expect(c).toEqual({ state: 'working' })
})
