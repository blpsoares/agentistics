import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { AppContext } from '../../lib/app-context'
import { TeamSettings, type TeamConfig } from '../../components/TeamSettings'

const DEFAULT_TEAM_CONFIG: TeamConfig = {
  mode: 'solo',
  endpoint: '',
  org: 'default',
  user: '',
  token: '',
}

export default function TeamSettingsPage() {
  const ctx = useOutletContext<AppContext>()
  const lang: 'pt' | 'en' = ctx.lang === 'pt' ? 'pt' : 'en'
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

  if (loadErr) {
    return (
      <div style={{
        padding: '10px 14px', borderRadius: 8,
        background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
        fontSize: 12, color: '#ef4444',
      }}>
        {loadErr}
      </div>
    )
  }

  return (
    <div>
      {/* TeamSettings handles saving explicitly via its Save button (member mode)
          or its own interval control (central mode). onChange just syncs local state. */}
      <TeamSettings team={team} onChange={setTeam} lang={lang} central={ctx.isCentral} presence={ctx.data.presence} />
    </div>
  )
}
