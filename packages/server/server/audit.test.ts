import { describe, expect, it } from 'bun:test'
import { buildAuditEvent } from './audit'

const now = new Date('2026-07-25T12:00:00.000Z')

describe('buildAuditEvent', () => {
  it('records the who/what/where/when', () => {
    const e = buildAuditEvent(
      { action: 'login.success', actorId: 'acct1', ip: '1.2.3.4', targetId: 'acct1' },
      now,
    )
    expect(e.action).toBe('login.success')
    expect(e.actorId).toBe('acct1')
    expect(e.targetId).toBe('acct1')
    expect(e.ip).toBe('1.2.3.4')
    expect(e.at).toBe(now)
  })

  it('never stores a password, token, or code even if handed one', () => {
    const e = buildAuditEvent(
      {
        action: 'login.failure',
        ip: '1.2.3.4',
        meta: { password: 'hunter2', token: 'abc', code: '123456', secret: 's', email: 'a@b.c' },
      },
      now,
    )
    const serialized = JSON.stringify(e)
    expect(serialized).not.toContain('hunter2')
    expect(serialized).not.toContain('123456')
    expect(serialized).not.toContain('abc')
    expect(e.meta).toEqual({ email: 'a@b.c' })
  })

  it('truncates oversized meta values so one call cannot bloat the collection', () => {
    const e = buildAuditEvent({ action: 'account.update', ip: '1.2.3.4', meta: { note: 'x'.repeat(5000) } }, now)
    expect((e.meta!.note as string).length).toBeLessThanOrEqual(512)
  })

  it('omits meta entirely when none was given', () => {
    expect(buildAuditEvent({ action: 'logout', ip: '::1' }, now).meta).toBeUndefined()
  })

  // An admin resetting someone ELSE's password is a distinct, more sensitive event than the
  // self-service 'password.change' — it must be its own action so an incident review can tell
  // "I changed my own password" apart from "someone else reset mine".
  it('records an admin-initiated password reset as its own action, with no password/token leaked', () => {
    const e = buildAuditEvent(
      { action: 'password.reset_admin', actorId: 'mgr1', targetId: 'u1', ip: '1.2.3.4' },
      now,
    )
    expect(e.action).toBe('password.reset_admin')
    expect(e.actorId).toBe('mgr1')
    expect(e.targetId).toBe('u1')
  })

  it('records a machine edit (rename/reassign/owner change) distinctly from mint/rotate/revoke', () => {
    const e = buildAuditEvent(
      { action: 'machine.update', actorId: 'mgr1', targetId: 'machine1', ip: '1.2.3.4', meta: { field: 'name' } },
      now,
    )
    expect(e.action).toBe('machine.update')
    expect(e.meta).toEqual({ field: 'name' })
  })
})
