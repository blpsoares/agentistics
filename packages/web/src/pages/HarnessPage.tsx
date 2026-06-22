import { useEffect, useState } from 'react'
import { useParams, useNavigate, useOutletContext } from 'react-router-dom'
import type { HarnessId } from '@agentistics/core'
import type { AppContext } from '../lib/app-context'
import { HARNESS_LABELS, HARNESS_COLORS } from '../lib/harness'
import { HarnessInfoPanel } from '../components/HarnessInfoPanel'
import HomePage from './HomePage'

const VALID_HARNESS_IDS: HarnessId[] = ['claude', 'codex', 'gemini', 'copilot']

type Tab = 'overview' | 'about'

export default function HarnessPage() {
  const { harness } = useParams<{ harness: string }>()
  const navigate = useNavigate()
  const ctx = useOutletContext<AppContext>()
  const lang = ctx.lang
  const [tab, setTab] = useState<Tab>('overview')

  const validHarness = VALID_HARNESS_IDS.includes(harness as HarnessId)
    ? (harness as HarnessId)
    : null

  // Reset to the overview tab whenever the harness changes.
  useEffect(() => { setTab('overview') }, [harness])

  useEffect(() => {
    if (!validHarness) {
      navigate('/', { replace: true })
      return
    }
    ctx.setFilters(f => ({ ...f, harness: validHarness }))
    return () => ctx.setFilters(f => ({ ...f, harness: undefined }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validHarness])

  if (!validHarness) return null

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: lang === 'pt' ? 'Visão geral' : 'Overview' },
    { id: 'about', label: lang === 'pt' ? 'Dados & fontes' : 'Data & sources' },
  ]
  const accent = HARNESS_COLORS[validHarness]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Harness tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginRight: 14 }}>
          <span style={{
            display: 'inline-block', width: 9, height: 9, borderRadius: '50%',
            background: accent, flexShrink: 0,
          }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: accent }}>
            {HARNESS_LABELS[validHarness]}
          </span>
        </div>
        {tabs.map(t => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                appearance: 'none', background: 'transparent', cursor: 'pointer',
                border: 'none', borderBottom: `2px solid ${active ? accent : 'transparent'}`,
                color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                fontSize: 13, fontWeight: active ? 600 : 500,
                padding: '8px 12px', marginBottom: -1,
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'overview' ? <HomePage /> : <HarnessInfoPanel harness={validHarness} />}
    </div>
  )
}
