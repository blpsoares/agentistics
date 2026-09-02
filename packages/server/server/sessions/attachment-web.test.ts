import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { ATTACHMENT_DIR, resolveAttachmentRead } from './attachment-web'

describe('resolveAttachmentRead', () => {
  it('resolves a plain path inside the attachment directory', () => {
    const p = join(ATTACHMENT_DIR, 'abcd1234-screenshot.png')
    expect(resolveAttachmentRead(p)).toBe(p)
  })

  it('refuses a path outside the attachment directory', () => {
    expect(resolveAttachmentRead('/etc/passwd')).toBeNull()
  })

  it('refuses a traversal that only LOOKS like it starts inside the directory', () => {
    // The raw string starts with ATTACHMENT_DIR; only resolving it first reveals it does not.
    expect(resolveAttachmentRead(join(ATTACHMENT_DIR, '..', '..', '.ssh', 'id_rsa'))).toBeNull()
  })

  it('refuses a sibling directory whose name happens to share the prefix', () => {
    // A bare string prefix check would let "ATTACHMENT_DIR-evil" through; the trailing separator
    // in the base guards exactly this.
    expect(resolveAttachmentRead(`${ATTACHMENT_DIR}-evil/file.png`)).toBeNull()
  })

  it('refuses an empty path', () => {
    expect(resolveAttachmentRead('')).toBeNull()
  })
})
