import type { CSSProperties } from 'react'
import { ChevronDown, ChevronRight, Search, GitBranch } from 'lucide-react'
import type { ShareTarget } from '../../lib/shareRepos'
import { plural } from '../../lib/shareRepos'
import { RowSwitch } from '../../pages/settings/primitives'
import { COPY, PLURAL_COPY, interpolate } from './copy'
import { relTime } from './cardState'
import {
  buildRows, groupRows, keepVisibleKeys, diffDraft, type EffectiveRow,
} from './repoPanelState'
import { fmtCost } from '@agentistics/core'

/**
 * SharedReposEditView.tsx — the edit-mode body of `SharedReposPanel.tsx` (Task 11). Split out for
 * the same reason `ConnectionCardParts.tsx` split out of `ConnectionCard.tsx` (Task 10): the parent
 * component owns the state machine (draft, search, apply phase), this file is pure layout over
 * `repoPanelState.ts`'s grouping/diff/impact — no decisions of its own beyond the mobile row cap.
 */

const MOBILE_ROW_CAP = 12

export function bulkBtnStyle(isMobile: boolean): CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: isMobile ? '0 12px' : '5px 10px', minHeight: isMobile ? 44 : undefined,
    borderRadius: 7, border: '1px solid var(--border)', background: 'transparent',
    color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  }
}

export function EditView({
  targets, draftDenied, diff, search, onSearch, showStale, onToggleStale, showAllMobile, onShowAllMobile,
  isMobile, lang, impactSessions, impactCost, onToggleRow, onShareAll, onBlockAll,
}: {
  targets: ShareTarget[]
  draftDenied: Set<string>
  diff: ReturnType<typeof diffDraft>
  search: string
  onSearch: (v: string) => void
  showStale: boolean
  onToggleStale: () => void
  showAllMobile: boolean
  onShowAllMobile: () => void
  isMobile: boolean
  lang: 'pt' | 'en'
  impactSessions: number
  impactCost: number
  onToggleRow: (target: ShareTarget, nextShared: boolean) => void
  onShareAll: () => void
  onBlockAll: () => void
}) {
  const rows = buildRows(targets, draftDenied)
  const grouped = groupRows(rows, search, keepVisibleKeys(diff))
  const sharedNow = rows.filter(r => r.target.sessions > 0 && !r.denied).length
  const totalNow = rows.filter(r => r.target.sessions > 0).length

  let blocked = grouped.blocked
  let shared = grouped.shared
  if (isMobile && !showAllMobile) {
    const cap = MOBILE_ROW_CAP
    blocked = grouped.blocked.slice(0, cap)
    shared = grouped.shared.slice(0, Math.max(0, cap - blocked.length))
  }
  const shownCount = blocked.length + shared.length
  const totalLiveCount = grouped.blocked.length + grouped.shared.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={onShareAll} style={bulkBtnStyle(isMobile)}>{COPY.shareAll[lang]}</button>
        <button type="button" onClick={onBlockAll} style={bulkBtnStyle(isMobile)}>{COPY.blockAll[lang]}</button>
        <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {interpolate(plural(PLURAL_COPY.nShared[lang], sharedNow), { n: sharedNow, total: totalNow })}
        </span>
      </div>

      <div style={{ position: 'relative' }}>
        <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
        <input
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder={COPY.searchRepos[lang]}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '7px 10px 7px 28px',
            background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 7,
            fontSize: 13, color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit',
          }}
        />
      </div>

      <div style={{
        display: 'flex', flexDirection: 'column', gap: 10,
        ...(isMobile ? {} : { maxHeight: 360, overflowY: 'auto' }),
      }}>
        {blocked.length > 0 && <RowGroup label={interpolate(COPY.groupBlocked[lang], { n: grouped.blocked.length })} rows={blocked} lang={lang} onToggleRow={onToggleRow} />}
        {shared.length > 0 && <RowGroup label={interpolate(COPY.groupShared[lang], { n: grouped.shared.length })} rows={shared} lang={lang} onToggleRow={onToggleRow} />}
      </div>

      {isMobile && !showAllMobile && shownCount < totalLiveCount && (
        <button type="button" onClick={onShowAllMobile} style={{ ...bulkBtnStyle(true), width: '100%' }}>
          {interpolate(COPY.showAllRepos[lang], { n: totalLiveCount })}
        </button>
      )}

      {grouped.stale.length > 0 && (
        <div>
          <button type="button" onClick={onToggleStale} style={{
            display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'none', border: 'none',
            padding: '4px 0', color: 'var(--text-tertiary)', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            {showStale ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {interpolate(plural(PLURAL_COPY.staleGroup[lang], grouped.stale.length), { n: grouped.stale.length })}
          </button>
          {showStale && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{COPY.staleHint[lang]}</span>
              {grouped.stale.map(r => (
                <div key={r.target.key} style={{ fontSize: 12, color: 'var(--text-secondary)', opacity: 0.7 }}>{r.target.name}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {impactSessions > 0 && (
        <div style={{
          padding: '8px 12px', borderRadius: 7, fontSize: 11.5, color: 'var(--text-secondary)',
          background: 'var(--bg-secondary)',
        }}>
          {interpolate(COPY.applyImpact[lang], { sessions: impactSessions, cost: fmtCost(impactCost) })}
        </div>
      )}
    </div>
  )
}

function RowGroup({ label, rows, lang, onToggleRow }: {
  label: string
  rows: EffectiveRow[]
  lang: 'pt' | 'en'
  onToggleRow: (target: ShareTarget, nextShared: boolean) => void
}) {
  const pt = lang === 'pt'
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase', margin: '2px 0 2px' }}>
        {label}
      </div>
      {rows.map(r => {
        const t = r.target
        const sub = r.locked
          ? COPY.mixedRepoWarn[lang]
          : t.kind === 'none'
            ? COPY.noRepoSub[lang]
            : `${interpolate(plural(PLURAL_COPY.sessionsN[lang], t.sessions), { n: t.sessions })}${t.lastActive ? ` · ${interpolate(COPY.lastActiveT[lang], { t: relTime(t.lastActive, pt) })}` : ''}`
        return (
          <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <RowSwitch
              on={!r.denied}
              onToggle={() => onToggleRow(t, r.denied)}
              label={t.name}
              sub={sub}
              icon={<GitBranch size={13} />}
              disabled={r.locked}
              dimmed={r.denied}
            />
            {t.host && (
              <span style={{
                flexShrink: 0, fontSize: 10, padding: '2px 6px', borderRadius: 999,
                background: 'var(--bg-elevated)', color: 'var(--text-tertiary)', border: '1px solid var(--border)',
              }}>{t.host}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
