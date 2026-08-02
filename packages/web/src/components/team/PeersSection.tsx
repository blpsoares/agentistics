import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useIsMobile } from '../../hooks/useIsMobile'
import { COPY, interpolate } from './copy'
import { peerLabel, type PeerFingerprint } from './proposalNotices'

/**
 * PeersSection — the machines of this account that receive this machine's sharing rules.
 *
 * COLLAPSED BY DEFAULT, deliberately. A fingerprint is a verification tool used once, not standing
 * information: the card states the FACT (how many machines receive your rules) in one row, and the
 * explanation travels WITH the fingerprints, behind the disclosure, where it is actionable.
 * Open by default it was four lines of preamble plus a 32-hex-digit row per machine, on a card
 * whose actual job is "is this connected and what am I sharing".
 */
export function PeersSection({ peers, selfFingerprint, lang }: {
  peers: PeerFingerprint[]
  selfFingerprint: string
  lang: 'pt' | 'en'
}) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  if (peers.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
          minHeight: isMobile ? 44 : undefined, padding: 0,
          border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 11.5, color: 'var(--text-secondary)', textAlign: 'left',
        }}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {interpolate(COPY.peersCount[lang], { n: peers.length })}
        <span style={{ color: 'var(--text-tertiary)' }}>· {COPY.peersShow[lang]}</span>
      </button>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 19 }}>
          <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{COPY.peersBody[lang]}</span>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {selfFingerprint && (
              <li style={{ fontSize: 10.5, color: 'var(--text-tertiary)', overflowWrap: 'anywhere' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{COPY.peersSelf[lang]}</span>
                {' — '}
                <code style={{ fontSize: 10.5 }}>{selfFingerprint}</code>
              </li>
            )}
            {peers.map(peer => (
              <li key={peer.machineId} style={{ fontSize: 10.5, color: 'var(--text-tertiary)', overflowWrap: 'anywhere' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{peerLabel(peer)}</span>
                {' — '}
                <code style={{ fontSize: 10.5 }}>{peer.fingerprint}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
