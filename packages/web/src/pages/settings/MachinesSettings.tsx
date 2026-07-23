import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { AppContext } from '../../lib/app-context'
import { TeamSettings, type TeamConfig } from '../../components/TeamSettings'
import { SectionHeader } from './primitives'

const DEFAULT_TEAM_CONFIG: TeamConfig = {
  mode: 'solo',
  endpoint: '',
  org: 'default',
  user: '',
  token: '',
}

export default function MachinesSettings() {
  const ctx = useOutletContext<AppContext>()
  const lang: 'pt' | 'en' = ctx.lang === 'pt' ? 'pt' : 'en'
  const pt = lang === 'pt'
  const [team, setTeam] = useState<TeamConfig>(DEFAULT_TEAM_CONFIG)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  // Load team preferences on mount
  useEffect(() => {
    fetch('/api/preferences')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((prefs: { team?: Partial<TeamConfig> }) => {
        if (prefs.team) {
          setTeam({ ...DEFAULT_TEAM_CONFIG, ...prefs.team })
        }
      })
      .catch(err => { setLoadErr(err instanceof Error ? err.message : String(err)) })
  }, [])

  return (
    <div>
      <SectionHeader label={pt ? 'Máquinas' : 'Machines'} />

      <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 18px' }}>
        {pt
          ? 'Máquinas de membros registradas — tokens, presença, rotação e revogação.'
          : 'Registered member machines — tokens, presence, rotate/revoke.'}
      </p>

      {loadErr ? (
        <div style={{
          padding: '10px 14px', borderRadius: 8,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
          fontSize: 12, color: '#ef4444',
        }}>
          {loadErr}
        </div>
      ) : (
        // TeamSettings handles saving explicitly via its Save button (member mode)
        // or its own interval control (central mode). onChange just syncs local state.
        <TeamSettings team={team} onChange={setTeam} lang={lang} central={ctx.isCentral} presence={ctx.data.presence} />
      )}
    </div>
  )
}
