/**
 * team-admin.test.ts — unit tests for the live-refresh notify seam on `handleMintToken`
 * (packages/server/server/team-admin.ts).
 *
 * Minting a token registers a new machine on the central; before this fix, the members panel
 * only picked it up on its next poll (`GET /api/team/members`), while revoke/rotate/rename all
 * refresh connected dashboards immediately. Both `mintToken` (Mongo) and `notify` (SSE) are
 * injected so this is asserted without touching Mongo or the real SSE machinery, per the
 * project's "do not mock the filesystem" convention (Mongo is the equivalent boundary here).
 */
import { describe, expect, it } from 'bun:test'
import { handleMintToken } from './team-admin'

function mintReq(body: unknown): Request {
  return new Request('http://localhost/api/team/tokens', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

describe('handleMintToken — live-refresh notify', () => {
  it('notifies once the token has actually been minted', async () => {
    let notifyCalls = 0
    const notify = () => { notifyCalls++ }
    const mint = async (user: string, label: string) => `tok-${user}-${label}`

    const res = await handleMintToken(mintReq({ user: 'alice', label: 'laptop' }), { mintToken: mint, notify })
    expect(res.status).toBe(200)
    const body = await res.json() as { token: string }
    expect(body.token).toBe('tok-alice-laptop')
    expect(notifyCalls).toBe(1)
  })

  it('does NOT notify when the request body fails validation (no mutation happened)', async () => {
    let notifyCalls = 0
    const notify = () => { notifyCalls++ }
    const mint = async () => { throw new Error('must not be called') }

    const res = await handleMintToken(mintReq({ user: '', label: 'laptop' }), { mintToken: mint, notify })
    expect(res.status).toBe(400)
    expect(notifyCalls).toBe(0)
  })

  it('does NOT notify when minting itself throws', async () => {
    let notifyCalls = 0
    const notify = () => { notifyCalls++ }
    const mint = async () => { throw new Error('mongo unreachable') }

    const res = await handleMintToken(mintReq({ user: 'alice', label: 'laptop' }), { mintToken: mint, notify })
    expect(res.status).toBe(500)
    expect(notifyCalls).toBe(0)
  })
})
