import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Plus, Trash2, Pencil } from 'lucide-react'
import { fmt, fmtCost, formatProjectName } from '@agentistics/core'
import type { AppContext } from '../lib/app-context'
import { HARNESS_LABELS } from '../lib/harness'
import { Drawer } from './settings/Drawer'
import { Section, Select, Checkbox, ConfirmModal, SectionHeader } from './settings/primitives'
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

const SWATCHES = [
  '#f59e0b', '#ef4444', '#ec4899', '#a855f7',
  '#3b82f6', '#06b6d4', '#22c55e', '#84cc16',
]
const DEFAULT_COLOR = SWATCHES[0]

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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [sources, setSources] = useState<TagSource[]>([])
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

  const addSource = () => {
    if (!draftValue) return
    if (sources.some(s => s.type === draftType && s.value === draftValue)) { setDraftValue(''); return }
    setSources(prev => [...prev, { type: draftType, value: draftValue }])
    setDraftValue('')
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
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--anthropic-orange)', wordBreak: 'break-word' }}>
              {fmtCost(t.aggregate.costUSD, currency, brlRate)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {t.aggregate.sessions.toLocaleString()} {pt ? 'sessões' : 'sessions'}
              {' · '}
              {fmt(t.aggregate.inputTokens + t.aggregate.outputTokens)} tok
            </div>
            <div style={{
              fontSize: 11, color: 'var(--text-tertiary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {t.sources.length} {t.sources.length === 1 ? (pt ? 'fonte' : 'source') : (pt ? 'fontes' : 'sources')}
              {t.aggregate.topProject && <> · {formatProjectName(t.aggregate.topProject)}</>}
            </div>
          </button>
        ))}
      </div>

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

        <Field label={pt ? 'Cor' : 'Colour'}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {SWATCHES.map(c => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => setColor(c)}
                style={{
                  width: 44, height: 44, padding: 0, borderRadius: 9, cursor: 'pointer',
                  background: 'transparent', fontFamily: 'inherit',
                  border: `1px solid ${color === c ? c : 'var(--border)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: c, display: 'block' }} />
              </button>
            ))}
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
                  onChange={setDraftValue}
                  options={optionsForType(draftType)}
                  placeholder={pt ? 'Selecione…' : 'Select…'}
                  searchPlaceholder={pt ? 'Buscar…' : 'Search…'}
                />
              </Field>
              <button
                type="button"
                style={{ ...ghostBtn, opacity: draftValue ? 1 : 0.5 }}
                disabled={!draftValue}
                onClick={addSource}
              >
                <Plus size={14} /> {pt ? 'Adicionar' : 'Add'}
              </button>
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
              {accounts.filter(a => a.id !== me?.id).map(a => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', minHeight: 44 }}>
                  <Checkbox
                    checked={sharedWith.includes(a.id)}
                    onChange={c => setSharedWith(prev => c ? [...prev, a.id] : prev.filter(x => x !== a.id))}
                    label={`${a.name} (${a.email})`}
                  />
                </div>
              ))}
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
