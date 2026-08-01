/**
 * envelope-keys.ts — the I/O edge of the sealed envelope: this machine's own keypair, and the
 * peer public keys it has PINNED.
 *
 * The private key is generated here, stored here (0600, under `~/.agentistics/connections`), and
 * goes nowhere else. It is never put in `preferences.json` (which is served, redacted, over
 * `GET /api/preferences`), never logged, never audited, and never included in any response body —
 * `publicKeyOnly()` is the only thing any route may see.
 *
 * Pinning is trust-on-first-use, and the decision itself is the pure `decidePin`
 * (`envelope-message.ts`). The honest limit — a central that substitutes a key at the moment of
 * FIRST sight reads that peer's envelopes — is documented in docs/security.md. What the pin buys
 * is that every substitution AFTER the first is loud: `'changed'` refuses to decrypt and surfaces
 * a warning, because a reinstall and an attack look identical from here and the machine must not
 * choose for the user.
 */
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { envelopeKeyFile, envelopePinsFile } from './config'
import { safeReadJson } from './utils'
import { generateMachineKeypair, fingerprintOf, type MachineKeypair } from './envelope-crypto'
import { decidePin, type PinDecision } from './envelope-message'

/** Cached so a push cycle does not re-read (and possibly re-generate) the key file every time. */
let _cached: MachineKeypair | null = null

/** Test-only: drop the in-process cache. */
export function __resetEnvelopeKeysForTests(): void {
  _cached = null
}

async function writePrivate(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  // Written before the content, so the file is never briefly world-readable with a key in it.
  await writeFile(path, body, { encoding: 'utf-8', mode: 0o600 })
  await chmod(path, 0o600).catch(() => { /* best-effort: some filesystems (WSL/DrvFs) refuse */ })
}

/**
 * This machine's keypair, generating and persisting one the first time. Automatic and
 * passphrase-less by design — the product requirement is that a second machine joining an account
 * works with nothing to type.
 */
export async function loadOrCreateKeypair(): Promise<MachineKeypair> {
  if (_cached) return _cached
  const path = envelopeKeyFile()
  const stored = await safeReadJson<Partial<MachineKeypair>>(path)
  if (stored && typeof stored.publicKey === 'string' && typeof stored.privateKey === 'string'
      && stored.publicKey !== '' && stored.privateKey !== '') {
    _cached = { publicKey: stored.publicKey, privateKey: stored.privateKey }
    return _cached
  }
  const fresh = generateMachineKeypair()
  await writePrivate(path, JSON.stringify(fresh, null, 2))
  _cached = fresh
  return fresh
}

/** The public half plus its human-comparable fingerprint. The ONLY shape any route may return. */
export async function publicKeyOnly(): Promise<{ publicKey: string; fingerprint: string }> {
  const kp = await loadOrCreateKeypair()
  return { publicKey: kp.publicKey, fingerprint: fingerprintOf(kp.publicKey) }
}

type PinMap = Record<string, string>

async function readPins(connId: string): Promise<PinMap> {
  const raw = await safeReadJson<unknown>(envelopePinsFile(connId))
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: PinMap = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v !== '') out[k] = v
  }
  return out
}

/** The key pinned for a peer on this connection, or `null` at first sight. */
export async function pinnedKeyFor(connId: string, machineId: string): Promise<string | null> {
  return (await readPins(connId))[machineId] ?? null
}

/**
 * Apply trust-on-first-use to a peer key the central just handed over. Returns what happened; the
 * caller decides what that means. A `'changed'` decision NEVER overwrites the stored pin — the
 * whole point is that the old key stays the reference until a human resolves it.
 */
export async function pinPeerKey(connId: string, machineId: string, publicKey: string): Promise<PinDecision> {
  if (!machineId || !publicKey) return 'changed'
  const pins = await readPins(connId)
  const decision = decidePin(pins[machineId], publicKey)
  if (decision === 'new') {
    pins[machineId] = publicKey
    await writePrivate(envelopePinsFile(connId), JSON.stringify(pins, null, 2))
  }
  return decision
}

/** Every pinned peer on a connection, with fingerprints — for the "compare two machines you own"
 *  affordance in the UI. Public keys only; there is nothing secret in this list. */
export async function pinnedPeers(connId: string): Promise<{ machineId: string; fingerprint: string }[]> {
  const pins = await readPins(connId)
  return Object.entries(pins)
    .map(([machineId, publicKey]) => ({ machineId, fingerprint: fingerprintOf(publicKey) }))
    .sort((a, b) => a.machineId.localeCompare(b.machineId))
}
