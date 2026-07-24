import { useOutletContext } from 'react-router-dom'
import type { AppContext } from '../../lib/app-context'
import { LIVE_INTERVAL_OPTIONS, LIVE_INTERVAL_OPTIONS_RISKY } from '../../hooks/useData'
import { SectionHeader, Divider, PrefRow, Toggle } from './primitives'

export default function LiveSettings() {
  const ctx = useOutletContext<AppContext>()
  const pt = ctx.lang === 'pt'
  const {
    liveUpdates, setLiveUpdates, updateInterval, setUpdateInterval,
    riskyMode, setRiskyMode, highlightUpdates, setHighlightUpdates,
  } = ctx

  const allIntervals = [...(riskyMode ? LIVE_INTERVAL_OPTIONS_RISKY : []), ...LIVE_INTERVAL_OPTIONS]

  return (
    <>
      {/* Live on/off */}
      <PrefRow
        label={pt ? 'Atualização em tempo real' : 'Live updates'}
        sub={pt ? 'Monitora mudanças automaticamente' : 'Automatically polls for changes'}
      >
        <Toggle on={liveUpdates} onToggle={() => setLiveUpdates(!liveUpdates)} />
      </PrefRow>

      <Divider />

      {/* Interval */}
      <SectionHeader label={pt ? 'Intervalo de atualização' : 'Update interval'} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
        {allIntervals.map(opt => {
          const isRisky = opt.value < 10
          const active = updateInterval === opt.value
          return (
            <button
              key={opt.value}
              onClick={() => { setUpdateInterval(opt.value); if (!liveUpdates) setLiveUpdates(true) }}
              style={{
                padding: '5px 12px', borderRadius: 6,
                border: active ? `1px solid ${isRisky ? '#ef4444' : 'var(--anthropic-orange)'}80` : '1px solid var(--border)',
                background: active ? (isRisky ? 'rgba(239,68,68,0.12)' : 'var(--anthropic-orange-dim)') : 'var(--bg-elevated)',
                color: active ? (isRisky ? '#ef4444' : 'var(--anthropic-orange)') : 'var(--text-secondary)',
                fontSize: 12, fontWeight: active ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.1s',
              }}
            >
              {isRisky ? `⚡ ${opt.label}` : opt.label}
            </button>
          )
        })}
      </div>

      <Divider />

      {/* Risky mode */}
      <PrefRow
        label={pt ? 'Modo arriscado' : 'Risky mode'}
        sub={pt
          ? 'Desbloqueia intervalos abaixo de 10s (até 1s). Pode aumentar o uso de CPU e I/O.'
          : 'Unlocks sub-10s intervals (down to 1s). May increase CPU and I/O load.'}
      >
        <Toggle
          on={riskyMode}
          onToggle={() => {
            const next = !riskyMode
            setRiskyMode(next)
            if (!next && updateInterval < 10) setUpdateInterval(10)
          }}
        />
      </PrefRow>

      <Divider />

      {/* Update highlights */}
      <PrefRow
        label={pt ? 'Destaques de atualização' : 'Update highlights'}
        sub={pt ? 'Destaca visualmente as seções que mudaram na última atualização.' : 'Briefly glows sections that changed on the last data update.'}
      >
        <Toggle on={highlightUpdates} onToggle={() => setHighlightUpdates(!highlightUpdates)} />
      </PrefRow>
    </>
  )
}
