import { test, expect } from 'bun:test'
import { buildConfirmMessage } from './SharedReposPanel'
import { COPY } from './copy'

/**
 * SharedReposPanel.test.ts — covers the one piece of `SharedReposPanel.tsx` worth testing outside
 * a DOM runner: `buildConfirmMessage`, the plain-string builder fed to `ConfirmModal.message`.
 *
 * Review fix (Important 1): the confirm modal must state the impact — the edit view's own
 * `applyImpact` line sits behind the modal's blur the moment it opens, so the number the user is
 * actually confirming has to be IN the modal, not merely visible somewhere behind it.
 */

test('the confirm message states the impact (session count and cost) when something is newly blocked', () => {
  const msg = buildConfirmMessage('generic', null, { sessions: 4, costUSD: 1.2345 }, 'none', 'en')
  expect(msg).toContain('4 sessions')
  expect(msg).toContain('1.23') // fmtCost's formatted amount — exact currency prefix not asserted
  expect(msg).toContain('Removes')
})

test('the confirm message omits the impact sentence entirely when nothing is newly blocked (sessions === 0)', () => {
  const msg = buildConfirmMessage('generic', null, { sessions: 0, costUSD: 0 }, 'none', 'en')
  expect(msg).not.toContain('Removes')
})

test('the confirm message includes the stats clause when boundary/prehistorySessions are known, and the proven clause only in the proven variant', () => {
  const stats = { boundary: '2026-06-01', n: 12 }
  const generic = buildConfirmMessage('generic', stats, { sessions: 0, costUSD: 0 }, 'none', 'en')
  expect(generic).toContain('2026-06-01')
  expect(generic).toContain('12')

  const proven = buildConfirmMessage('proven', stats, { sessions: 0, costUSD: 0 }, 'none', 'en')
  expect(proven).toContain('2026-06-01')
  // The proven sentence is strictly additional — the generic clause's own boundary mention plus
  // the proven clause's own boundary mention.
  expect(proven.length).toBeGreaterThan(generic.length)
})

test('the confirm message omits the stats clause entirely when boundary is unknowable (null)', () => {
  const msg = buildConfirmMessage('generic', null, { sessions: 0, costUSD: 0 }, 'none', 'en')
  // No stray, invented numbers from a stats clause that was never built.
  expect(msg).not.toContain('undefined')
  expect(msg).not.toContain('null')
})

test('works in Portuguese too — the body text is language-specific, the numbers are not', () => {
  const msg = buildConfirmMessage('generic', null, { sessions: 7, costUSD: 0.5 }, 'none', 'pt')
  expect(msg).toContain('7')
  expect(msg.toLowerCase()).toContain('apaga')
})

// --- Plan 4 Task 7: the mode-switch sentence, appended only when the mode actually changed -------

test('modeVariant "none" appends no mode sentence at all', () => {
  const msg = buildConfirmMessage('generic', null, { sessions: 0, costUSD: 0 }, 'none', 'en')
  expect(msg).not.toContain(COPY.modeConfirmToAllowlist.en)
  expect(msg).not.toContain(COPY.modeConfirmToDenylist.en)
})

test('modeVariant "toAllowlist" appends the allowlist-switch consequence, never the denylist one', () => {
  const msg = buildConfirmMessage('generic', null, { sessions: 0, costUSD: 0 }, 'toAllowlist', 'en')
  expect(msg).toContain(COPY.modeConfirmToAllowlist.en)
  expect(msg).not.toContain(COPY.modeConfirmToDenylist.en)
})

test('modeVariant "toDenylist" appends the denylist-switch consequence, never the allowlist one', () => {
  const msg = buildConfirmMessage('generic', null, { sessions: 0, costUSD: 0 }, 'toDenylist', 'en')
  expect(msg).toContain(COPY.modeConfirmToDenylist.en)
  expect(msg).not.toContain(COPY.modeConfirmToAllowlist.en)
})
