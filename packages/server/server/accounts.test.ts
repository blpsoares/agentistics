import { test, expect } from 'bun:test'
import { makeAccountDoc } from './accounts'

test('makeAccountDoc is deterministic and normalizes the email', () => {
  const doc = makeAccountDoc(
    { name: 'Alice', email: '  Alice@Example.COM ', passwordHash: '$argon2id$x', role: 'owner', memberships: [] },
    'id123',
    '2026-07-22T00:00:00.000Z',
  )
  expect(doc).toEqual({
    _id: 'id123',
    name: 'Alice',
    email: '  Alice@Example.COM ',
    emailLower: 'alice@example.com',
    passwordHash: '$argon2id$x',
    role: 'owner',
    memberships: [],
    sessionVersion: 0,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    createdBy: undefined,
    lastLoginAt: null,
  })
})
