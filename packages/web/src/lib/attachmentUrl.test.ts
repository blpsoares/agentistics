import { describe, expect, it } from 'bun:test'
import { attachmentNameUrl, attachmentUrl, galleryFileUrl, sessionMediaUrl } from './attachmentUrl'

describe('galleryFileUrl', () => {
  const sessionId = 's1'

  it('a sent file (or one with no origin — every group written before "viewed" existed) is read by NAME', () => {
    const f = { path: '/home/u/.agentistics/attachments/abcd-shot.png', name: 'abcd-shot.png', origin: 'sent' as const }
    expect(galleryFileUrl(f, sessionId)).toBe(attachmentNameUrl('abcd-shot.png'))
    expect(galleryFileUrl({ path: f.path, name: f.name }, sessionId)).toBe(attachmentNameUrl('abcd-shot.png'))
  })

  it('a produced file is read through the SESSION media route, by path', () => {
    const f = { path: '/repo/out/report.png', name: 'report.png', origin: 'produced' as const }
    expect(galleryFileUrl(f, sessionId)).toBe(sessionMediaUrl(sessionId, f.path))
  })

  it('a VIEWED file re-read from the attachments directory goes through the attachment route, by PATH', () => {
    // It was never sent BY THIS message, so it cannot be read by name (the gallery's sent side
    // addresses only what it grouped) — but it is still inside the attachments directory, and the
    // path-based route's containment check does not care which message put it there.
    const f = { path: '/home/u/.agentistics/attachments/abcd-shot.png', name: 'abcd-shot.png', origin: 'viewed' as const }
    expect(galleryFileUrl(f, sessionId)).toBe(attachmentUrl(f.path))
  })

  it('a VIEWED file anywhere else falls to the session media route — never widened, never guessed', () => {
    const f = { path: '/repo/some/screenshot.png', name: 'screenshot.png', origin: 'viewed' as const }
    expect(galleryFileUrl(f, sessionId)).toBe(sessionMediaUrl(sessionId, f.path))
  })
})
