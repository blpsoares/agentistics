import { describe, expect, it } from 'bun:test'
import { planArtifactRead } from './artifact-file'

const cwd = '/home/u/proj'
const allowed = ['/home/u/proj/docs/spec.md', '/home/u/proj/src/a.ts']

describe('planArtifactRead', () => {
  it('allows a path the session touched, inside the cwd', () => {
    expect(planArtifactRead({ path: '/home/u/proj/docs/spec.md', cwd, allowed }))
      .toEqual({ ok: true, path: '/home/u/proj/docs/spec.md' })
  })

  it('refuses a path the session never touched, even inside the cwd', () => {
    // The reachable set is a consequence of what the session DID, not a rule about directories.
    // `/home/u/proj/.env` is in the project and has nothing to do with this conversation.
    expect(planArtifactRead({ path: '/home/u/proj/.env', cwd, allowed }))
      .toEqual({ ok: false, reason: 'not-touched' })
  })

  it('refuses a resolved path outside the cwd', () => {
    // The caller resolves first, so this is what an escaping symlink or a `..` LOOKS like here.
    expect(planArtifactRead({ path: '/home/u/.ssh/id_ed25519', cwd, allowed: ['/home/u/.ssh/id_ed25519'] }))
      .toEqual({ ok: false, reason: 'outside-cwd' })
  })

  it('refuses a sibling directory whose name merely starts with the cwd', () => {
    // `/home/u/proj-secrets` starts with `/home/u/proj` as a STRING and is a different directory.
    // Containment is by path SEGMENT, never by prefix.
    expect(planArtifactRead({
      path: '/home/u/proj-secrets/x.md', cwd, allowed: ['/home/u/proj-secrets/x.md'],
    })).toEqual({ ok: false, reason: 'outside-cwd' })
  })

  it('refuses the cwd itself — a directory is not a file', () => {
    expect(planArtifactRead({ path: cwd, cwd, allowed: [cwd] }))
      .toEqual({ ok: false, reason: 'not-a-file' })
  })

  it('refuses an empty path without pretending it is anything else', () => {
    expect(planArtifactRead({ path: '', cwd, allowed }))
      .toEqual({ ok: false, reason: 'not-touched' })
  })

  it('checks membership BEFORE containment, so an unrelated path never reveals the cwd', () => {
    // Answering `outside-cwd` for a path nobody asked about would confirm where the cwd is not.
    expect(planArtifactRead({ path: '/etc/passwd', cwd, allowed }).ok).toBe(false)
    expect(planArtifactRead({ path: '/etc/passwd', cwd, allowed }))
      .toEqual({ ok: false, reason: 'not-touched' })
  })
})
