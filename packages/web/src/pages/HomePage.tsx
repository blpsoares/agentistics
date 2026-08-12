import React from 'react'
import { useOutletContext } from 'react-router-dom'
import { useIsMobile } from '../hooks/useIsMobile'
import { format } from 'date-fns'
import {
  MessageSquare, Zap, Clock, Flame, GitCommit,
  Wrench, FileCode, TrendingUp, BarChart2,
  Download, Upload, Trophy, Bot, Target,
  Calendar,
} from 'lucide-react'
import type { AppContext } from '../lib/app-context'
import { sessionTime } from '../lib/sessionTime'
import { planAllocation, projectFolder, t } from '@agentistics/core'
import { widerValue } from '../lib/statCardSize'
import { fmt, fmtFull, fmtDuration, fmtCost } from '@agentistics/core'
import type { Lang } from '@agentistics/core'
import type { HarnessId } from '@agentistics/core'
import { Section } from '../components/Section'
import { StatCard } from '../components/StatCard'
import { HighlightsBoard } from '../components/HighlightsBoard'
import { ActivityChart } from '../components/ActivityChart'
import { ActivityHeatmap } from '../components/ActivityHeatmap'
import { HourChart } from '../components/HourChart'
import { ModelBreakdown } from '../components/ModelBreakdown'
import { BudgetPanel } from '../components/BudgetPanel'
import { CacheHitRatePanel } from '../components/CacheHitRatePanel'
import { ProjectsList } from '../components/ProjectsList'
import { TagCloud } from '../components/TagCloud'
import { ToolMetricsPanel } from '../components/ToolMetricsPanel'
import { AgentMetricsPanel } from '../components/AgentMetricsPanel'
import { RecentSessions } from '../components/RecentSessions'
import { capable, HARNESS_PROVIDERS } from '../lib/harness'
import { StreakBreakdownButton } from '../components/StreakBreakdownButton'
import { CostBasisToggle } from '../components/CostBasisToggle'
import { planCostSubtitle, viewCost } from '../lib/costBasis'

type CardId = 'messages' | 'sessions' | 'tool-calls' | 'input-tokens' | 'output-tokens' | 'cost' | 'streak' | 'longest-session' | 'commits' | 'files'

export default function HomePage() {
  const ctx = useOutletContext<AppContext>()
  const {
    data, derived, statsCache, filters, setFilters,
    lang, theme, currency, setCurrency, brlRate,
    monthlyBudgetUSD, updateBudget,
    totalInputTokens, totalOutputTokens,
    setExpandedChart, setSelectedSession, setInfoModalIndex,
    infoItems, cardOrder,
    cardPrecision, setCardPrecision,
    costBasis, setCostBasis, planBasis, billingReady, openBillingSetup,
  } = ctx
  const d = derived
  const isMobile = useIsMobile()

  function costCardSub(activeLang: Lang, harness: HarnessId | undefined): string {
    if (!harness) return t('card.est_cost_sub_generic', activeLang)
    const provider = HARNESS_PROVIDERS[harness] ?? 'Anthropic'
    return t('card.est_cost_sub_with_provider', activeLang).replace('{provider}', provider)
  }

  const planFactor = planBasis.basis ? planAllocation(planBasis.basis).aggregateFactor : null
  // Agents are Claude-only, so they allocate against CLAUDE's plan, not the fleet's aggregate.
  const claudePlanFactor = costBasis === 'plan' && planBasis.basis
    ? planAllocation(planBasis.basis).byHarness.claude ?? null
    : null
  function planCostSub(activeLang: Lang): string {
    return planCostSubtitle({
      multiple: planBasis.basis?.multiple ?? null,
      window: planBasis.window,
      uncoveredDays: planBasis.basis?.coverage.uncoveredDays ?? 0,
      lang: activeLang === 'pt' ? 'pt' : 'en',
    })
  }
  const CostBasisButton = ({ lang: l }: { lang: Lang }) => (
    <CostBasisToggle
      basis={costBasis}
      ready={billingReady.ready && planBasis.basis !== null}
      onChange={setCostBasis}
      onSetup={openBillingSetup}
      lang={l === 'pt' ? 'pt' : 'en'}
    />
  )

  function renderCard(id: CardId) {
    const fullKey = `kpi.${id}`
    const full = cardPrecision[fullKey] ?? false
    const toggleFull = () => setCardPrecision(fullKey, !full)
    const tog = (rawVal: number) => rawVal >= 1000 ? toggleFull : undefined

    let card: React.ReactNode = null
    if (id === 'messages') {
      card = <StatCard lang={lang} label={lang === 'pt' ? 'Mensagens' : 'Messages'} value={full ? fmtFull(d.totalMessages) : fmt(d.totalMessages)} sub={lang === 'pt' ? 'no período selecionado' : 'in selected period'} icon={<MessageSquare size={15} />} accent="var(--anthropic-orange)" info={infoItems[0]} onInfoClick={() => setInfoModalIndex(0)} fullPrecision={full} onTogglePrecision={tog(d.totalMessages)} />
    } else if (id === 'sessions') {
      card = <StatCard lang={lang} label={lang === 'pt' ? 'Sessões' : 'Sessions'} value={full ? fmtFull(d.totalSessions) : fmt(d.totalSessions)} sub={`avg ${d.totalSessions > 0 ? Math.round(d.totalMessages / d.totalSessions) : 0} msgs/sessão`} icon={<Zap size={15} />} accent="var(--accent-blue)" info={infoItems[1]} onInfoClick={() => setInfoModalIndex(1)} fullPrecision={full} onTogglePrecision={tog(d.totalSessions)} />
    } else if (id === 'tool-calls') {
      card = <StatCard lang={lang} label={lang === 'pt' ? 'Tool calls' : 'Tool calls'} value={full ? fmtFull(d.totalToolCalls) : fmt(d.totalToolCalls)} sub={lang === 'pt' ? 'execuções totais' : 'total executions'} icon={<Wrench size={15} />} accent="var(--accent-green)" info={infoItems[2]} onInfoClick={() => setInfoModalIndex(2)} fullPrecision={full} onTogglePrecision={tog(d.totalToolCalls)} />
    } else if (id === 'input-tokens') {
      card = <StatCard lang={lang} label={lang === 'pt' ? 'Tokens entrada' : 'Input tokens'} value={full ? fmtFull(totalInputTokens) : fmt(totalInputTokens)} sub={lang === 'pt' ? 'tokens enviados ao modelo' : 'tokens sent to model'} icon={<Download size={15} />} accent="var(--accent-blue)" info={infoItems[8]} onInfoClick={() => setInfoModalIndex(8)} fullPrecision={full} onTogglePrecision={tog(totalInputTokens)} />
    } else if (id === 'output-tokens') {
      card = <StatCard lang={lang} label={lang === 'pt' ? 'Tokens saída' : 'Output tokens'} value={full ? fmtFull(totalOutputTokens) : fmt(totalOutputTokens)} sub={lang === 'pt' ? 'tokens gerados pelo modelo' : 'tokens generated by model'} icon={<Upload size={15} />} accent="var(--accent-purple)" info={infoItems[9]} onInfoClick={() => setInfoModalIndex(9)} fullPrecision={full} onTogglePrecision={tog(totalOutputTokens)} />
    } else if (id === 'cost') {
      // In plan basis the headline is C — what the plan actually cost over the measured days —
      // and the subline carries the multiple plus the WINDOW. The window is not decoration: a
      // user who filtered "all time" and got a figure over the last 90 days (as far back as the
      // daily series reaches) has a correct number under a misleading heading, and naming the
      // days measured is the only thing that corrects it.
      const planView = viewCost(d.totalCostUSD, { basis: costBasis, factor: planFactor })
      const showPlan = costBasis === 'plan' && !planView.unavailable && planBasis.basis !== null
      const shownUSD = showPlan ? planView.usd : d.totalCostUSD
      card = (
        <StatCard
          label={showPlan ? (lang === 'pt' ? 'Custo do plano' : 'Plan cost') : (lang === 'pt' ? 'Custo estimado' : 'Est. cost')}
          value={fmtCost(shownUSD, currency, brlRate)}
          // Sized by whichever currency renders wider, so flipping USD ⇄ BRL never resizes the
          // headline — BRL is ~5× the amount and can carry an extra digit.
          sizeBasis={widerValue(fmtCost(shownUSD, 'USD', brlRate), fmtCost(shownUSD, 'BRL', brlRate))}
          sub={showPlan ? planCostSub(lang) : costCardSub(lang, filters.harness)}
          icon={<TrendingUp size={15} />} accent="var(--anthropic-orange)" info={infoItems[5]} onInfoClick={() => setInfoModalIndex(5)}
          action={
            <span style={{ display: 'inline-flex', gap: 4 }}>
              <CostBasisButton lang={lang} />
              <button onClick={() => setCurrency(currency === 'USD' ? 'BRL' : 'USD')} style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s', letterSpacing: '0.03em' }} title={currency === 'USD' ? 'Switch to BRL (R$)' : 'Switch to USD'}>
                {currency}
              </button>
            </span>
          }
        />
      )
    } else if (id === 'streak') {
      const bestStr = d.longestStreak > 0 ? ` · ${lang === 'pt' ? 'recorde' : 'best'}: ${d.longestStreak}d` : ''
      const streakSub = d.streak === 0 && d.streakLastActiveDate
        ? (lang === 'pt'
          ? `último dia ativo: ${format(new Date(d.streakLastActiveDate + 'T12:00:00'), 'dd/MM')}${bestStr}`
          : `last active: ${format(new Date(d.streakLastActiveDate + 'T12:00:00'), 'MMM d')}${bestStr}`)
        : `${lang === 'pt' ? 'dias consecutivos' : 'consecutive days'}${bestStr}`
      card = <StatCard label={lang === 'pt' ? 'Sequência' : 'Streak'} value={`${d.streak}d`} sub={streakSub} icon={<Flame size={15} />} accent="#ef4444" info={infoItems[3]} onInfoClick={() => setInfoModalIndex(3)}
        action={d.streakDayBreakdown && d.streakDayBreakdown.length > 0 && filters.projects.length !== 1 ? <StreakBreakdownButton items={d.streakDayBreakdown} pt={lang === 'pt'} /> : undefined}
      />
    } else if (id === 'longest-session') {
      card = (
        <StatCard label={lang === 'pt' ? 'Sessão mais longa' : 'Longest session'}
          value={(() => {
            // Headline is the ACTIVE time; the wall clock moves to the sub-line. Ranking is by
            // active time too (useDerivedStats), so the two always describe the same session.
            const t = sessionTime(d.longestSession, lang)
            return d.longestSession ? (t.active ?? t.elapsed) : '—'
          })()}
          valueTitle={d.longestSession ? sessionTime(d.longestSession, lang).tooltip : undefined}
          sub={d.longestSession ? (() => {
            const t = sessionTime(d.longestSession, lang)
            const msgs = (d.longestSession!.user_message_count ?? 0) + (d.longestSession!.assistant_message_count ?? 0)
            // Both figures are NAMED here ("active" / "elapsed") but NOT explained: the full
            // definition lives in the ⓘ modal and the value tooltip. Spelled out on the card it
            // wrapped to three lines and stretched the whole grid row. The project is its folder
            // name, not the absolute path, for the same reason — and `subNoWrap` guarantees it,
            // since a long enough folder name would otherwise wrap and bring the row back up.
            return `${t.activeLabel} · ${t.elapsed} ${t.elapsedLabel} · ${msgs} ${lang === 'pt' ? 'msgs' : 'msgs'}`
              + (filters.projects.length === 0 && d.longestSession!.project_path
                ? ` · ${projectFolder(d.longestSession!.project_path)}`
                : '')
          })() : ''}
          subNoWrap
          icon={<Clock size={15} />} accent="var(--accent-purple)" info={infoItems[4]} onInfoClick={() => setInfoModalIndex(4)} />
      )
    } else if (id === 'commits') {
      // Two facts, said as two. The KPI is what the ASSISTANTS did (summable, filterable by
      // harness); the repository figure — a `git log`, which also counts what was committed by
      // hand — is context beside it, and is absent whenever it would not mean anything here.
      // `\n`, not ` · `: StatCard renders the sub as `pre-line` precisely so it can be a couple of
      // short labelled lines, which is also what keeps it readable at 390px.
      const commitsSub = [
        [lang === 'pt' ? 'por assistentes' : 'by assistants',
         d.gitPushes > 0 ? `${fmt(d.gitPushes)} pushes` : ''].filter(Boolean).join(' · '),
        d.repoGit ? `· ${fmt(d.repoGit.commits)} ${lang === 'pt' ? 'no repositório' : 'in the repository'}` : '',
      ].filter(Boolean).join('\n')
      card = <StatCard label="Commits" value={d.gitCommits} sub={commitsSub} icon={<GitCommit size={15} />} accent="var(--accent-cyan)" info={infoItems[6]} onInfoClick={() => setInfoModalIndex(6)} />
    } else if (id === 'files') {
      const canGitLines = !filters.harness || capable(filters.harness, 'gitLines')
      const filesSub = canGitLines && d.linesAdded + d.linesRemoved > 0
        ? `+${fmt(d.linesAdded)} / -${fmt(d.linesRemoved)} ${lang === 'pt' ? 'linhas' : 'lines'}`
        : canGitLines
          ? (lang === 'pt' ? 'por assistentes' : 'by assistants')
          : (lang === 'pt' ? 'linhas adicionadas/removidas não disponíveis' : 'lines added/removed not available')
      card = <StatCard label={lang === 'pt' ? 'Arquivos' : 'Files'} value={d.filesModified} sub={filesSub} icon={<FileCode size={15} />} accent="var(--accent-green)" info={infoItems[7]} onInfoClick={() => setInfoModalIndex(7)} />
    }

    return (
      <div
        key={id}
        data-flash-id={id}
        style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}
      >
        {card}
      </div>
    )
  }

  return (
    <>
      {/* Session date range */}
      {derived.firstSessionDate && derived.lastSessionDate && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-tertiary)', flexWrap: 'wrap' }}>
          <Calendar size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
          <span style={{ fontSize: 11, opacity: 0.7 }}>{lang === 'pt' ? '1ª sessão' : 'first session'}</span>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{format(derived.firstSessionDate, 'MMM d, yyyy')}</span>
          <span style={{ opacity: 0.4 }}>→</span>
          <span style={{ fontSize: 11, opacity: 0.7 }}>{lang === 'pt' ? 'última sessão' : 'last session'}</span>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{format(derived.lastSessionDate, 'MMM d, yyyy')}</span>
          <span style={{ opacity: 0.3, margin: '0 2px' }}>·</span>
          <span><strong style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{derived.sessionSpanDays.toLocaleString()}</strong> {lang === 'pt' ? 'dias' : 'days'}</span>
        </div>
      )}

      {/* KPI Cards grid */}
      <style>{`
        @keyframes liveFlash {
          0%   { box-shadow: 0 0 0 2px rgba(217,119,6,0.55), 0 0 14px rgba(217,119,6,0.12); }
          60%  { box-shadow: 0 0 0 2px rgba(217,119,6,0.18), 0 0 6px rgba(217,119,6,0.04); }
          100% { box-shadow: 0 0 0 0px rgba(217,119,6,0); }
        }
        .live-flash { animation: liveFlash 1.2s ease-out forwards; border-radius: var(--radius-lg); }
      `}</style>
      <div className="ag-grid cols-5">
        {(cardOrder as CardId[]).map(id => renderCard(id))}
      </div>

      {/* Highlights */}
      <Section flashId="highlights" title={<><Trophy size={14} /> {lang === 'pt' ? 'Recordes' : 'Highlights'}</>}>
        <HighlightsBoard sessions={derived.filteredSessions} projects={data.projects as any} lang={lang} harness={filters.harness} />
      </Section>

      {/* Activity + Heatmap */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '3fr 2fr', gap: 16, alignItems: 'stretch' }}>
        <Section flashId="activity" style={{ height: '100%' }} title={<><BarChart2 size={14} /> {lang === 'pt' ? 'Atividade ao longo do tempo' : 'Activity over time'}</>} onExpand={() => setExpandedChart('activity')}>
          <ActivityChart data={derived.heatmapData} theme={theme} />
        </Section>
        <Section flashId="heatmap" style={{ height: '100%' }} title={lang === 'pt' ? 'Heatmap de atividade' : 'Activity heatmap'} onExpand={() => setExpandedChart('heatmap')}>
          <ActivityHeatmap data={derived.heatmapData} />
        </Section>
      </div>

      {/* Hour distribution */}
      <Section flashId="hours" title={lang === 'pt' ? 'Uso por hora do dia' : 'Usage by hour'} onExpand={() => setExpandedChart('hours')}>
        <HourChart hourCounts={derived.hourCounts} hourMeta={derived.hourMeta} />
      </Section>

      {/* Model usage */}
      <Section flashId="models" title={<><TrendingUp size={14} /> {lang === 'pt' ? 'Uso por modelo' : 'Model usage & cost'}</>} onExpand={() => setExpandedChart('models')}>
        <ModelBreakdown
          modelUsage={derived.modelUsage}
          currency={currency}
          planFactor={costBasis === "plan" ? planFactor : null}
          brlRate={brlRate}
          fallbackInputTokens={filters.projects.length > 0 ? derived.inputTokens : undefined}
          fallbackOutputTokens={filters.projects.length > 0 ? derived.outputTokens : undefined}
          fallbackCostUSD={filters.projects.length > 0 ? derived.totalCostUSD : undefined}
          note={
            filters.dateRange !== 'all' || filters.customStart || filters.customEnd
              ? (lang === 'pt'
                ? '* Valores aproximados: tokens rateados pelo total diário. Proporção input/output baseada no histórico global.'
                : '* Approximate values: tokens prorated from daily totals. Input/output split based on global historical ratio.')
              : undefined
          }
        />
      </Section>

      {/* Budget */}
      <Section flashId="budget" title={<><Target size={14} /> {lang === 'pt' ? 'Orçamento & projeção' : 'Budget & forecast'}</>}>
        <BudgetPanel statsCache={statsCache} budgetUSD={monthlyBudgetUSD} onBudgetChange={updateBudget} currency={currency} brlRate={brlRate} lang={lang} monthlyCommitmentUSD={ctx.monthCommitment?.usd ?? null} commitmentPartial={ctx.monthCommitment?.partial ?? false} harness={filters.harness} />
      </Section>

      {/* Cache — full width */}
      <Section flashId="cache" title={<><Zap size={14} /> {lang === 'pt' ? 'Eficiência de cache' : 'Cache efficiency'}</>}>
        <CacheHitRatePanel hitRate={derived.cacheHitRate} cacheTotals={derived.cacheTotals} grossSavedUSD={derived.cacheGrossSavedUSD} writeOverheadUSD={derived.cacheWriteOverheadUSD} netSavedUSD={derived.cacheNetSavedUSD} perModel={derived.cachePerModel} currency={currency} brlRate={brlRate} costBasis={costBasis} lang={lang} harness={filters.harness} />
      </Section>

      {/* Projects + Languages */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '3fr 2fr', gap: 16, alignItems: 'stretch' }}>
        <Section flashId="projects" style={{ height: '100%' }} title={<><FileCode size={14} /> {lang === 'pt' ? 'Principais projetos' : 'Top projects'}</>}
          action={filters.projects.length > 0 ? (
            <button onClick={() => setFilters(f => ({ ...f, projects: [] }))} style={{ fontSize: 11, color: 'var(--text-tertiary)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              {lang === 'pt' ? 'Limpar' : 'Clear'}
            </button>
          ) : null}
        >
          <ProjectsList projectStats={derived.projectStats} onFilter={path => setFilters(f => ({ ...f, projects: [path] }))} />
        </Section>
        <Section title={<><FileCode size={14} /> {lang === 'pt' ? 'Linguagens' : 'Languages'}</>} style={{ height: '100%' }}>
          <TagCloud data={derived.langCounts} color="var(--accent-blue)" />
        </Section>
      </div>

      {/* Tool metrics */}
      <Section flashId="tools" title={<><Wrench size={14} /> {lang === 'pt' ? 'Métricas de ferramentas' : 'Tool metrics'}</>}>
        <ToolMetricsPanel toolCounts={derived.toolCounts} toolOutputTokens={derived.toolOutputTokens} agentFileReads={derived.agentFileReads} lang={lang} />
      </Section>

      {/* Agent metrics */}
      <Section flashId="agents" title={<><Bot size={14} /> {lang === 'pt' ? 'Métricas de agentes' : 'Agent metrics'}</>}>
        <AgentMetricsPanel invocations={derived.agentInvocations} agentTypeBreakdown={derived.agentTypeBreakdown} totalInvocations={derived.totalAgentInvocations} totalTokens={derived.totalAgentTokens} totalCostUSD={derived.totalAgentCostUSD} totalDurationMs={derived.totalAgentDurationMs} currency={currency} brlRate={brlRate} planFactor={claudePlanFactor} lang={lang} harness={filters.harness} />
      </Section>

      {/* Recent sessions */}
      <Section flashId="sessions-list" title={<><Clock size={14} /> {lang === 'pt' ? 'Sessões recentes' : 'Recent sessions'}</>}>
        <RecentSessions sessions={derived.filteredSessions} lang={lang} onSelect={setSelectedSession} />
      </Section>
    </>
  )
}
