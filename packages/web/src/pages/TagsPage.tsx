import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Plus, Trash2, Pencil, X } from 'lucide-react'
import { fmt, fmtCost, formatProjectName } from '@agentistics/core'
import type { AppContext } from '../lib/app-context'
import { HARNESS_LABELS } from '../lib/harness'
import { Drawer } from './settings/Drawer'
import { Section, Select, Checkbox, ConfirmModal, SectionHeader, TabSelect } from './settings/primitives'
import { useIsMobile } from '../hooks/useIsMobile'

// /api/tags response shapes. Aggregate-only by design (spec rule 2): the server never sends the
// session rows behind a tag, so everything rendered here is a number the server already computed.
type TagSourceType = 'repo' | 'project' | 'machine' | 'team' | 'account'
interface TagSource { type: TagSourceType; value: string }
interface TagAggregate {
  sessions: number
  costUSD: number
  inputTokens: number
  outputTokens: number
  topProject: string | null
  topModel: string | null
  topHarness: string | null
}
interface Tag {
  _id: string
  name: string
  color?: string
  sources: TagSource[]
  sharedWith: string[]
  createdBy: string
  aggregate: TagAggregate
}
interface TagDetail {
  tag: Tag
  breakdown: { source: TagSource; aggregate: TagAggregate }[]
}

// IAM lookups used to turn a source's opaque id into a readable label and to populate the pickers.
interface IamTeam { _id: string; name: string }
interface IamAccount { id: string; name: string; email: string }
interface IamMachine { id: string; machineName: string }

const SWATCHES: string[] = [
  '#f59e0b', '#ef4444', '#ec4899', '#a855f7',
  '#3b82f6', '#06b6d4', '#22c55e', '#84cc16',
]
// Explicit, not SWATCHES[0]: noUncheckedIndexedAccess types an index read as `string | undefined`,
// which would leak `undefined` into every consumer of the selected colour.
const DEFAULT_COLOR = '#f59e0b'

/** A label/value pair inside a grid card. */
function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ minWidth: 0 }}>
      <span style={{ display: 'block', fontSize: 9.5, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </span>
  )
}

/** A rounded tag-ish chip for the "top X" facts on a grid card. */
function Pill({ text }: { text: string }) {
  return (
    <span style={{
      display: 'inline-block', maxWidth: '100%', padding: '2px 8px', borderRadius: 999, fontSize: 10.5,
      background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-tertiary)',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>{text}</span>
  )
}

/** One column of the list layout. The label is always rendered so the row stays readable when it
 *  reflows to a single column on mobile, where there is no header row to name the values. */
function Cell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ fontSize: 9.5, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>{label}</span>
      <span style={{
        fontSize: 12.5, fontWeight: accent ? 700 : 600,
        color: accent ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
        fontVariantNumeric: 'tabular-nums', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{value}</span>
    </span>
  )
}

const input: React.CSSProperties = {
  padding: '9px 11px', background: 'var(--bg-elevated)', border: '1px solid var(--border)',
  borderRadius: 7, fontSize: 13, color: 'var(--text-primary)', fontFamily: 'inherit',
  outline: 'none', width: '100%', boxSizing: 'border-box',
}
const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '0 14px', minHeight: 44, borderRadius: 7, border: '1px solid var(--anthropic-orange)',
  background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)',
  fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}
const ghostBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '0 12px', minHeight: 44, borderRadius: 7,
  border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)',
  fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}
const trashBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 44, height: 44, flexShrink: 0,
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>
      {children}
    </label>
  )
}

/** One number + caption, used for the detail headline. */
function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{
        fontSize: 18, fontWeight: 700, wordBreak: 'break-word',
        color: accent ? 'var(--anthropic-orange)' : 'var(--text-primary)',
      }}>{value}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
    </div>
  )
}

export default function TagsPage() {
  const { lang, currency, brlRate, data, me } = useOutletContext<AppContext>()
  const pt = lang === 'pt'
  const isMobile = useIsMobile()

  const [tags, setTags] = useState<Tag[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  // IAM lookups (labels + picker options). Failures are non-fatal: the pickers just come up empty.
  const [teams, setTeams] = useState<IamTeam[]>([])
  const [accounts, setAccounts] = useState<IamAccount[]>([])
  const [machines, setMachines] = useState<IamMachine[]>([])

  const loadTags = useCallback(async () => {
    try {
      const r = await fetch('/api/tags')
      const d = await r.json() as { tags?: Tag[]; error?: string }
      if (d.error) { setErr(d.error); setTags([]) } else { setErr(null); setTags(d.tags ?? []) }
    } catch (e) { setErr(String(e)) } finally { setLoaded(true) }
  }, [])

  useEffect(() => { void loadTags() }, [loadTags])

  useEffect(() => {
    void (async () => {
      const [t, a, m] = await Promise.all([
        fetch('/api/iam/teams').then(r => r.ok ? r.json() as Promise<{ teams?: IamTeam[] }> : { teams: [] }).catch(() => ({ teams: [] })),
        fetch('/api/iam/accounts').then(r => r.ok ? r.json() as Promise<{ accounts?: IamAccount[] }> : { accounts: [] }).catch(() => ({ accounts: [] })),
        fetch('/api/iam/machines').then(r => r.ok ? r.json() as Promise<{ machines?: IamMachine[] }> : { machines: [] }).catch(() => ({ machines: [] })),
      ])
      setTeams(t.teams ?? []); setAccounts(a.accounts ?? []); setMachines(m.machines ?? [])
    })()
  }, [])

  // repo / project options come from the data the page already has — no extra endpoint.
  const repoOptions = useMemo(() => {
    const set = new Set<string>()
    for (const s of data.sessions) if (s.git_remote) set.add(s.git_remote)
    return [...set].sort().map(v => ({ value: v, label: v }))
  }, [data.sessions])
  const projectOptions = useMemo(() => {
    const set = new Set<string>()
    for (const s of data.sessions) if (s.project_path) set.add(s.project_path)
    return [...set].sort().map(v => ({ value: v, label: formatProjectName(v) }))
  }, [data.sessions])

  const teamName = useCallback((id: string) => teams.find(t => t._id === id)?.name ?? id, [teams])
  const accountName = useCallback((id: string) => accounts.find(a => a.id === id)?.name ?? id, [accounts])
  const machineName = useCallback((id: string) => machines.find(m => m.id === id)?.machineName ?? id, [machines])

  const sourceTypeLabel = useCallback((t: TagSourceType) => ({
    repo: pt ? 'Repositório' : 'Repository',
    project: pt ? 'Projeto' : 'Project',
    machine: pt ? 'Máquina' : 'Machine',
    team: pt ? 'Time' : 'Team',
    account: pt ? 'Conta' : 'Account',
  }[t]), [pt])

  const sourceValueLabel = useCallback((s: TagSource) => {
    switch (s.type) {
      case 'team': return teamName(s.value)
      case 'account': return accountName(s.value)
      case 'machine': return machineName(s.value)
      case 'project': return formatProjectName(s.value)
      default: return s.value
    }
  }, [teamName, accountName, machineName])

  const optionsForType = useCallback((t: TagSourceType) => {
    switch (t) {
      case 'repo': return repoOptions
      case 'project': return projectOptions
      case 'machine': return machines.map(m => ({ value: m.id, label: m.machineName }))
      case 'team': return teams.map(t2 => ({ value: t2._id, label: t2.name }))
      case 'account': return accounts.map(a => ({ value: a.id, label: `${a.name} (${a.email})` }))
      default: return []
    }
  }, [repoOptions, projectOptions, machines, teams, accounts])

  // detail drawer
  const [detail, setDetail] = useState<TagDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailErr, setDetailErr] = useState<string | null>(null)

  const openDetail = useCallback(async (id: string) => {
    setDetail(null); setDetailErr(null); setDetailOpen(true)
    try {
      const r = await fetch(`/api/tags/${encodeURIComponent(id)}`)
      const d = await r.json() as { tag?: Tag; breakdown?: TagDetail['breakdown']; error?: string }
      if (d.error || !d.tag) setDetailErr(d.error ?? 'not found')
      else setDetail({ tag: d.tag, breakdown: d.breakdown ?? [] })
    } catch (e) { setDetailErr(String(e)) }
  }, [])

  // editor drawer (create + edit share one form)
  const [editorOpen, setEditorOpen] = useState(false)
  // Grid (compact cards) vs list (dense rows with more metrics). Persisted across reloads.
  const [layout, setLayout] = useState<'grid' | 'list'>(() => {
    try { return localStorage.getItem('agentistics-tags-layout') === 'list' ? 'list' : 'grid' } catch { return 'grid' }
  })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [sources, setSources] = useState<TagSource[]>([])
  // True when the chosen colour is not one of the presets — drives the custom circle's ring.
  const isCustomColor = !SWATCHES.some(c => c.toLowerCase() === color.toLowerCase())
  const [sharedWith, setSharedWith] = useState<string[]>([])
  const [draftType, setDraftType] = useState<TagSourceType>('repo')
  const [draftValue, setDraftValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [sourcesEditing, setSourcesEditing] = useState(true)
  const [shareEditing, setShareEditing] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState<Tag | null>(null)

  const openCreate = useCallback(() => {
    setEditingId(null); setName(''); setColor(DEFAULT_COLOR); setSources([]); setSharedWith([])
    setDraftType('repo'); setDraftValue(''); setSaveErr(null)
    setSourcesEditing(true); setShareEditing(true)
    setEditorOpen(true)
  }, [])

  const openEdit = useCallback((t: Tag) => {
    setEditingId(t._id); setName(t.name); setColor(t.color || DEFAULT_COLOR)
    setSources(t.sources); setSharedWith(t.sharedWith)
    setDraftType('repo'); setDraftValue(''); setSaveErr(null)
    setSourcesEditing(true); setShareEditing(true)
    setEditorOpen(true)
  }, [])

  // The Drawer's unsaved-changes guard: anything typed or added counts as dirty.
  const original = editingId ? tags.find(t => t._id === editingId) : undefined
  const dirty = editingId
    ? !!original && (
      name.trim() !== original.name
      || color !== (original.color || DEFAULT_COLOR)
      || JSON.stringify(sources) !== JSON.stringify(original.sources)
      || JSON.stringify([...sharedWith].sort()) !== JSON.stringify([...original.sharedWith].sort())
    )
    : name.trim().length > 0 || sources.length > 0

  /** Commit a picked value as a source. Called straight from the value Select's onChange so a
   *  single click adds it — the old two-step (pick, then press "Add") silently dropped the pick
   *  when the user pressed Done instead, saving a tag with no sources at all. */
  const addSource = (value: string) => {
    if (!value) return
    setDraftValue('')
    if (sources.some(s => s.type === draftType && s.value === value)) return
    setSources(prev => [...prev, { type: draftType, value }])
  }

  const save = async () => {
    if (!name.trim()) { setSaveErr(pt ? 'Informe um nome.' : 'A name is required.'); return }
    setSaving(true); setSaveErr(null)
    try {
      const body = { id: editingId ?? undefined, name: name.trim(), color, sources, sharedWith }
      const res = await fetch('/api/tags', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { setSaveErr(d.error ?? `HTTP ${res.status}`); return }
      setEditorOpen(false)
      await loadTags()
    } catch (e) { setSaveErr(String(e)) } finally { setSaving(false) }
  }

  const doDelete = async (t: Tag) => {
    setConfirmDelete(null)
    await fetch('/api/tags', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: t._id }),
    })
    setDetailOpen(false)
    await loadTags()
  }

  const mayWrite = me?.role === 'owner' || !!me?.memberships.some(m => m.role === 'manager')
  const mayEdit = (t: Tag) => me?.role === 'owner' || t.createdBy === me?.id

  const totalLabel = pt ? 'Total (sem duplicidade)' : 'Total (deduplicated)'

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap', margin: '0 0 18px',
      }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Tags</h1>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
            {pt
              ? 'Agrupamentos salvos de repositórios, projetos, máquinas, times e contas.'
              : 'Saved groupings of repositories, projects, machines, teams and accounts.'}
          </div>
        </div>
        {mayWrite && (
          <button type="button" onClick={openCreate} style={{ ...primaryBtn, width: isMobile ? '100%' : undefined }}>
            <Plus size={14} /> {pt ? 'Nova tag' : 'New tag'}
          </button>
        )}
      </div>

      {err && <div style={{ fontSize: 12.5, color: '#ef4444', marginBottom: 14 }}>{err}</div>}

      {loaded && !err && tags.length === 0 && (
        <div style={{
          border: '1px dashed var(--border)', borderRadius: 12, padding: 24,
          fontSize: 12.5, color: 'var(--text-tertiary)', textAlign: 'center',
        }}>
          {pt ? 'Nenhuma tag ainda.' : 'No tags yet.'}
        </div>
      )}

      {/* Grid = compact cards (6 facts). List = a dense row per tag (10 facts) using the horizontal
          room a card does not have. The choice persists so it survives a reload. */}
      {tags.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <TabSelect
            value={layout}
            onChange={v => { setLayout(v); try { localStorage.setItem('agentistics-tags-layout', v) } catch { /* ignore */ } }}
            options={[
              { value: 'grid', label: pt ? 'Grade' : 'Grid' },
              { value: 'list', label: pt ? 'Lista' : 'List' },
            ]}
          />
        </div>
      )}

      {layout === 'grid' ? (
        <div className="ag-grid cols-3">
          {tags.map(t => (
            <button
              key={t._id}
              type="button"
              onClick={() => void openDetail(t._id)}
              style={{
                border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-card)',
                padding: 16, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0,
                textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: t.color || 'var(--anthropic-orange)', flexShrink: 0,
                }} />
                <span style={{
                  fontSize: 14, fontWeight: 700, color: 'var(--text-primary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{t.name}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-tertiary)', flexShrink: 0 }}>
                  {t.sources.length} {t.sources.length === 1 ? (pt ? 'fonte' : 'source') : (pt ? 'fontes' : 'sources')}
                </span>
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--anthropic-orange)', wordBreak: 'break-word' }}>
                {fmtCost(t.aggregate.costUSD, currency, brlRate)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px' }}>
                <MiniStat label={pt ? 'Sessões' : 'Sessions'} value={t.aggregate.sessions.toLocaleString()} />
                <MiniStat label="Tokens" value={fmt(t.aggregate.inputTokens + t.aggregate.outputTokens)} />
                <MiniStat label={pt ? 'Entrada' : 'Input'} value={fmt(t.aggregate.inputTokens)} />
                <MiniStat label={pt ? 'Saída' : 'Output'} value={fmt(t.aggregate.outputTokens)} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 2 }}>
                {t.aggregate.topProject && <Pill text={formatProjectName(t.aggregate.topProject)} />}
                {t.aggregate.topModel && <Pill text={t.aggregate.topModel} />}
                {t.aggregate.topHarness && <Pill text={HARNESS_LABELS[t.aggregate.topHarness as keyof typeof HARNESS_LABELS] ?? t.aggregate.topHarness} />}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          {tags.map((t, i) => (
            <button
              key={t._id}
              type="button"
              onClick={() => void openDetail(t._id)}
              style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'minmax(140px, 1.4fr) repeat(4, minmax(70px, 0.8fr)) minmax(110px, 1.2fr) minmax(90px, 1fr) minmax(70px, 0.7fr) minmax(60px, 0.6fr)',
                gap: isMobile ? 6 : 12, alignItems: 'center', width: '100%',
                padding: isMobile ? '12px 14px' : '11px 14px', minHeight: 48,
                background: 'var(--bg-card)', border: 'none',
                borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)',
                textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: t.color || 'var(--anthropic-orange)', flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
              </span>
              <Cell label={pt ? 'Custo' : 'Cost'} value={fmtCost(t.aggregate.costUSD, currency, brlRate)} accent />
              <Cell label={pt ? 'Sessões' : 'Sessions'} value={t.aggregate.sessions.toLocaleString()} />
              <Cell label={pt ? 'Entrada' : 'Input'} value={fmt(t.aggregate.inputTokens)} />
              <Cell label={pt ? 'Saída' : 'Output'} value={fmt(t.aggregate.outputTokens)} />
              <Cell label={pt ? 'Projeto' : 'Project'} value={t.aggregate.topProject ? formatProjectName(t.aggregate.topProject) : '—'} />
              <Cell label={pt ? 'Modelo' : 'Model'} value={t.aggregate.topModel ?? '—'} />
              <Cell label="Harness" value={t.aggregate.topHarness ? (HARNESS_LABELS[t.aggregate.topHarness as keyof typeof HARNESS_LABELS] ?? t.aggregate.topHarness) : '—'} />
              <Cell label={pt ? 'Fontes' : 'Sources'} value={String(t.sources.length)} />
            </button>
          ))}
        </div>
      )}

      {/* ---- detail ---- */}
      <Drawer
        open={detailOpen}
        title={detail?.tag.name ?? (pt ? 'Tag' : 'Tag')}
        onClose={() => setDetailOpen(false)}
        lang={lang}
        footer={detail && mayEdit(detail.tag) ? (
          <>
            <button type="button" style={ghostBtn} onClick={() => setConfirmDelete(detail.tag)}>
              <Trash2 size={14} /> {pt ? 'Excluir' : 'Delete'}
            </button>
            <button type="button" style={primaryBtn} onClick={() => { setDetailOpen(false); openEdit(detail.tag) }}>
              <Pencil size={14} /> {pt ? 'Editar' : 'Edit'}
            </button>
          </>
        ) : undefined}
      >
        {detailErr && <div style={{ fontSize: 12.5, color: '#ef4444' }}>{detailErr}</div>}
        {!detail && !detailErr && (
          <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>{pt ? 'Carregando…' : 'Loading…'}</div>
        )}
        {detail && (
          <>
            <SectionHeader label={totalLabel} />
            <div className="ag-grid cols-3" style={{ gap: 14 }}>
              <Stat label={pt ? 'Custo' : 'Cost'} value={fmtCost(detail.tag.aggregate.costUSD, currency, brlRate)} accent />
              <Stat label={pt ? 'Sessões' : 'Sessions'} value={detail.tag.aggregate.sessions.toLocaleString()} />
              <Stat label="Tokens" value={fmt(detail.tag.aggregate.inputTokens + detail.tag.aggregate.outputTokens)} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
              {([
                [pt ? 'Projeto principal' : 'Top project', detail.tag.aggregate.topProject ? formatProjectName(detail.tag.aggregate.topProject) : null],
                [pt ? 'Modelo principal' : 'Top model', detail.tag.aggregate.topModel],
                [pt ? 'Harness principal' : 'Top harness', detail.tag.aggregate.topHarness
                  ? (HARNESS_LABELS[detail.tag.aggregate.topHarness as keyof typeof HARNESS_LABELS] ?? detail.tag.aggregate.topHarness)
                  : null],
              ] as [string, string | null][]).map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5 }}>
                  <span style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>{label}</span>
                  <span style={{ color: 'var(--text-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {value ?? '—'}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16, marginTop: 8 }}>
              <SectionHeader label={pt ? 'Por fonte' : 'Per source'} />
              {/* The per-source numbers deliberately sum to MORE than the tag total when sources
                  overlap — a session counted by two sources is counted once in the total. That gap
                  is the dedupe working, so say so instead of letting it read as a bug. */}
              <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginBottom: 12, lineHeight: 1.5 }}>
                {pt
                  ? 'Fontes podem se sobrepor: somar as linhas abaixo pode dar mais que o total, que conta cada sessão uma única vez.'
                  : 'Sources can overlap: summing the rows below may exceed the total, which counts each session exactly once.'}
              </div>
              {detail.breakdown.length === 0 && (
                <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
                  {pt ? 'Nenhuma fonte configurada.' : 'No sources configured.'}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {detail.breakdown.map((b, i) => (
                  <div key={`${b.source.type}:${b.source.value}:${i}`} style={{
                    border: '1px solid var(--border-subtle)', borderRadius: 9, padding: '10px 12px',
                    display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0,
                  }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {sourceTypeLabel(b.source.type)}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                      {sourceValueLabel(b.source)}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                      {fmtCost(b.aggregate.costUSD, currency, brlRate)}
                      {' · '}
                      {b.aggregate.sessions.toLocaleString()} {pt ? 'sessões' : 'sessions'}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {me && me.role !== 'owner' && (
              <div style={{
                marginTop: 8, fontSize: 11.5, color: 'var(--text-tertiary)',
                lineHeight: 1.5, borderTop: '1px solid var(--border-subtle)', paddingTop: 12,
              }}>
                {pt
                  ? 'O dashboard filtrado mostra apenas as sessões que você já tem permissão para ver — o total da tag pode ser maior.'
                  : 'The filtered dashboard shows only sessions you already have access to — the tag total may be higher.'}
              </div>
            )}
          </>
        )}
      </Drawer>

      {/* ---- create / edit ---- */}
      <Drawer
        open={editorOpen}
        title={editingId ? (pt ? 'Editar tag' : 'Edit tag') : (pt ? 'Nova tag' : 'New tag')}
        onClose={() => setEditorOpen(false)}
        lang={lang}
        dirty={dirty}
        footer={
          <button type="button" style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={() => void save()}>
            {saving ? (pt ? 'Salvando…' : 'Saving…') : (pt ? 'Salvar' : 'Save')}
          </button>
        }
      >
        {saveErr && <div style={{ fontSize: 12.5, color: '#ef4444' }}>{saveErr}</div>}

        <Field label={pt ? 'Nome' : 'Name'}>
          <input
            style={input}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={pt ? 'Cliente X' : 'Client X'}
          />
        </Field>

        {/* Colour picker: bare circles with a selection RING rather than boxed squares — the boxes
            competed with the swatch for attention and read as disabled buttons. Each circle keeps a
            44px hit area while drawing at 26px, so touch targets survive without visual bulk. The
            ring is drawn with two stacked box-shadows (a gap in the card background, then the
            colour), the same treatment the rest of the app uses for focus affordances. */}
        <Field label={pt ? 'Cor' : 'Colour'}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
            {SWATCHES.map(c => {
              const selected = color.toLowerCase() === c.toLowerCase()
              return (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  aria-pressed={selected}
                  onClick={() => setColor(c)}
                  style={{
                    width: 44, height: 44, padding: 0, border: 'none', background: 'transparent',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <span style={{
                    width: 26, height: 26, borderRadius: '50%', background: c, display: 'block',
                    boxShadow: selected ? `0 0 0 3px var(--bg-card), 0 0 0 5px ${c}` : 'none',
                    transition: 'box-shadow 0.15s, transform 0.15s',
                    transform: selected ? 'scale(1)' : 'scale(0.92)',
                  }} />
                </button>
              )
            })}

            <span style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 6px', flexShrink: 0 }} />

            {/* Custom colour. The native input is the only control giving a full gamut without
                shipping a picker; it is kept invisible over a styled circle so the row stays
                consistent instead of showing the OS swatch chrome. */}
            <label
              title={pt ? 'Cor personalizada' : 'Custom colour'}
              style={{
                width: 44, height: 44, cursor: 'pointer', position: 'relative',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}
            >
              <span style={{
                width: 26, height: 26, borderRadius: '50%', display: 'block',
                background: 'conic-gradient(#ef4444, #f59e0b, #84cc16, #22c55e, #06b6d4, #3b82f6, #a855f7, #ec4899, #ef4444)',
                boxShadow: isCustomColor ? `0 0 0 3px var(--bg-card), 0 0 0 5px ${color}` : 'none',
                transition: 'box-shadow 0.15s, transform 0.15s',
                transform: isCustomColor ? 'scale(1)' : 'scale(0.92)',
              }} />
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
              />
            </label>

            {/* Live readout so the chosen value is legible and copyable, mono like the rest of the
                app's identifier chips. */}
            <span style={{
              marginLeft: 4, padding: '3px 9px', borderRadius: 999, flexShrink: 0,
              background: `color-mix(in srgb, ${color} 14%, transparent)`,
              border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
              color, fontSize: 11, fontWeight: 600,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', textTransform: 'uppercase',
            }}>{color}</span>
          </div>
        </Field>

        <Section
          title={pt ? 'Fontes' : 'Sources'}
          editing={sourcesEditing}
          onEdit={() => setSourcesEditing(true)}
          onCancel={() => setSourcesEditing(false)}
          onSave={() => setSourcesEditing(false)}
          labels={{ edit: pt ? 'Editar' : 'Edit', save: pt ? 'Pronto' : 'Done', cancel: pt ? 'Fechar' : 'Close' }}
          editChildren={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                {pt
                  ? 'A tag reúne as sessões de qualquer uma das fontes (união). Time e conta resolvem dinamicamente.'
                  : 'The tag covers sessions matching any of its sources (union). Team and account resolve dynamically.'}
              </div>
              <Field label={pt ? 'Tipo' : 'Type'}>
                <Select
                  value={draftType}
                  onChange={v => { setDraftType(v as TagSourceType); setDraftValue('') }}
                  options={(['repo', 'project', 'machine', 'team', 'account'] as TagSourceType[])
                    .map(t => ({ value: t, label: sourceTypeLabel(t) }))}
                />
              </Field>
              <Field label={pt ? 'Valor' : 'Value'}>
                <Select
                  value={draftValue}
                  onChange={addSource}
                  options={optionsForType(draftType).filter(o => !sources.some(s => s.type === draftType && s.value === o.value))}
                  placeholder={pt ? 'Selecione para adicionar…' : 'Select to add…'}
                  searchPlaceholder={pt ? 'Buscar…' : 'Search…'}
                />
              </Field>
              <SourceList
                sources={sources}
                typeLabel={sourceTypeLabel}
                valueLabel={sourceValueLabel}
                emptyLabel={pt ? 'Nenhuma fonte adicionada.' : 'No sources added.'}
                onRemove={i => setSources(prev => prev.filter((_, j) => j !== i))}
              />
            </div>
          }
        >
          <SourceList
            sources={sources}
            typeLabel={sourceTypeLabel}
            valueLabel={sourceValueLabel}
            emptyLabel={pt ? 'Nenhuma fonte adicionada.' : 'No sources added.'}
          />
        </Section>

        <Section
          title={pt ? 'Compartilhar com' : 'Share with'}
          editing={shareEditing}
          onEdit={() => setShareEditing(true)}
          onCancel={() => setShareEditing(false)}
          onSave={() => setShareEditing(false)}
          labels={{ edit: pt ? 'Editar' : 'Edit', save: pt ? 'Pronto' : 'Done', cancel: pt ? 'Fechar' : 'Close' }}
          editChildren={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                {pt
                  ? 'Quem receber a tag vê os números completos dela. Owners e o criador já têm acesso.'
                  : 'Anyone granted the tag sees its full numbers. Owners and the creator already have access.'}
              </div>
              {accounts.length === 0 && (
                <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
                  {pt ? 'Nenhuma conta disponível.' : 'No accounts available.'}
                </div>
              )}
              {/* Type-to-filter picker rather than a checkbox list: on a central with many accounts
                  the list is unscannable, and picking adds immediately (same one-click rule as
                  sources). Granted accounts show as removable chips below. */}
              {accounts.length > 0 && (
                <Field label={pt ? 'Adicionar conta' : 'Add account'}>
                  <Select
                    value=""
                    onChange={id => { if (id) setSharedWith(prev => prev.includes(id) ? prev : [...prev, id]) }}
                    options={accounts
                      .filter(a => a.id !== me?.id && !sharedWith.includes(a.id))
                      .map(a => ({ value: a.id, label: `${a.name} (${a.email})` }))}
                    placeholder={pt ? 'Buscar conta…' : 'Search an account…'}
                    searchPlaceholder={pt ? 'Buscar…' : 'Search…'}
                    searchable
                  />
                </Field>
              )}
              {sharedWith.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {sharedWith.map(id => {
                    const a = accounts.find(x => x.id === id)
                    return (
                      <span key={id} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 8px 5px 10px',
                        borderRadius: 999, fontSize: 11.5, background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)', color: 'var(--text-secondary)',
                      }}>
                        {a ? a.name : id}
                        <button
                          type="button"
                          onClick={() => setSharedWith(prev => prev.filter(x => x !== id))}
                          aria-label={pt ? 'Remover' : 'Remove'}
                          style={{ border: 'none', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer', display: 'inline-flex', padding: 2 }}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          }
        >
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
            {sharedWith.length === 0
              ? (pt ? 'Somente você e os owners.' : 'Only you and the owners.')
              : sharedWith.map(accountName).join(', ')}
          </div>
        </Section>
      </Drawer>

      <ConfirmModal
        open={!!confirmDelete}
        title={pt ? 'Excluir tag?' : 'Delete tag?'}
        message={pt
          ? `A tag "${confirmDelete?.name ?? ''}" será removida. As sessões não são afetadas.`
          : `The tag "${confirmDelete?.name ?? ''}" will be removed. Sessions are not affected.`}
        confirmLabel={pt ? 'Excluir' : 'Delete'}
        cancelLabel={pt ? 'Cancelar' : 'Cancel'}
        onConfirm={() => { if (confirmDelete) void doDelete(confirmDelete) }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}

/** Committed source list; rows are removable only when `onRemove` is given (edit mode). */
function SourceList({ sources, typeLabel, valueLabel, emptyLabel, onRemove }: {
  sources: TagSource[]
  typeLabel: (t: TagSourceType) => string
  valueLabel: (s: TagSource) => string
  emptyLabel: string
  onRemove?: (index: number) => void
}) {
  if (sources.length === 0) {
    return <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>{emptyLabel}</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {sources.map((s, i) => (
        <div key={`${s.type}:${s.value}:${i}`} style={{
          display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
          border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '4px 4px 4px 10px',
        }}>
          <span style={{
            fontSize: 10.5, fontWeight: 700, color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0,
          }}>{typeLabel(s.type)}</span>
          <span style={{
            fontSize: 12.5, color: 'var(--text-primary)', minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
          }}>{valueLabel(s)}</span>
          {onRemove && (
            <button type="button" style={trashBtn} aria-label="Remove" onClick={() => onRemove(i)}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
