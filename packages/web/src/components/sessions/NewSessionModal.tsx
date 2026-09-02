/**
 * NewSessionModal — starting a session from the dashboard.
 *
 * It asks the FULL path the terminal wizard asks — assistant, where, task, model, effort, first
 * message, name — not a reduced form. What the web adds is that each answer is SHOWN rather than
 * spelled: a mark per assistant, a repository distinguished from a plain folder, and effort as a
 * coloured scale.
 *
 * TWO RULES CARRIED OVER FROM THE TERMINAL WIZARD, both load-bearing:
 *
 * - The assistants offered are the ones `availableHarnesses()` found ON PATH. Anything else would
 *   start a tmux session that dies on `command not found` behind a screen nobody is watching.
 * - `model` and `effort` are SKIPPED, not shown-and-disabled, when the spawn spec has no flag for
 *   them. `efforts` is a CLOSED set read from each CLI's own `--help` — agy prints one, codex
 *   deliberately has none — so the scale decorates a real set and may never imply a level the
 *   harness does not accept.
 */

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, FolderGit2, Folder, Loader, Search, X } from 'lucide-react'
import { HARNESS_COLORS, HARNESS_LABELS } from '../../lib/harness'
import { effortColor, effortSteps } from '../../lib/effortScale'
import { HarnessMark } from './HarnessMark'

interface HarnessOption {
  id: string
  label: string
  modelSuggestions: string[]
  supportsModel: boolean
  efforts: string[]
}

interface ProjectOption {
  path: string
  label: string
  repo?: string
  detail: string
  source: string
}

export interface NewSessionModalProps {
  lang: 'pt' | 'en'
  onClose: () => void
  /** Called with the new session's id when one starts, so the page can select it immediately. */
  onStarted: (id?: string) => void
}

export function NewSessionModal({ lang, onClose, onStarted }: NewSessionModalProps) {
  const pt = lang === 'pt'
  const [harnesses, setHarnesses] = useState<HarnessOption[] | null>(null)
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [tasks, setTasks] = useState<string[]>([])
  const [query, setQuery] = useState('')

  const [harness, setHarness] = useState<HarnessOption | null>(null)
  const [cwd, setCwd] = useState('')
  const [task, setTask] = useState('')
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState('')
  const [prompt, setPrompt] = useState('')
  const [label, setLabel] = useState('')

  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await fetch(`/api/fleet/new?lang=${lang}&q=${encodeURIComponent(query)}`)
        if (!res.ok || !alive) return
        const json = await res.json() as {
          harnesses: HarnessOption[]; projects: ProjectOption[]; tasks: string[]
        }
        setHarnesses(json.harnesses)
        setProjects(json.projects)
        setTasks(json.tasks)
        // Pre-select the only assistant there is. A one-item picker is a question with one answer.
        setHarness(h => h ?? (json.harnesses.length === 1 ? json.harnesses[0]! : null))
      } catch { /* transient — the picker keeps what it had */ }
    }
    void load()
    return () => { alive = false }
  }, [lang, query])

  // Reset the answers a DIFFERENT assistant does not accept. Carrying `effort: 'high'` across to a
  // harness whose set does not contain it would send a flag the CLI rejects at spawn.
  useEffect(() => {
    setModel('')
    setEffort('')
  }, [harness?.id])

  const efforts = useMemo(() => effortSteps(harness?.efforts ?? []), [harness])
  const canStart = harness !== null && cwd !== '' && !busy

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function start() {
    if (!canStart) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch(`/api/fleet/spawn?lang=${lang}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          harness: harness!.id,
          cwd,
          ...(task ? { task } : {}),
          ...(model ? { model } : {}),
          ...(effort ? { effort } : {}),
          ...(prompt ? { prompt } : {}),
          ...(label ? { label } : {}),
        }),
      })
      const json = await res.json() as { ok: boolean; message: string; id?: string }
      setBusy(false)
      if (json.ok) { onStarted(json.id); return }
      setNotice(json.message)
    } catch {
      setBusy(false)
      setNotice(pt ? 'Erro de rede ao falar com esta máquina.' : 'Network error talking to this machine.')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={pt ? 'Nova sessão' : 'New session'}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 400,
        background: 'var(--ag-scrim)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 16, width: '100%', maxWidth: 620, maxHeight: '86vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <header style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
        }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>
            {pt ? 'Nova sessão' : 'New session'}
          </h2>
          <button
            onClick={onClose}
            aria-label={pt ? 'Fechar' : 'Close'}
            style={{
              display: 'flex', width: 30, height: 30, alignItems: 'center', justifyContent: 'center',
              borderRadius: 8, border: 'none', background: 'transparent',
              color: 'var(--text-tertiary)', cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </header>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Field label={pt ? 'Assistente' : 'Assistant'}>
            {harnesses === null ? (
              <Muted text={pt ? 'Vendo o que está instalado…' : 'Checking what is installed…'} />
            ) : harnesses.length === 0 ? (
              // Not an empty picker: the machine looked and found nothing it knows how to start.
              <Muted text={pt
                ? 'Nenhum assistente que o agentop saiba iniciar foi encontrado nesta máquina.'
                : 'No assistant agentop knows how to start was found on this machine.'} />
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {harnesses.map(h => {
                  const on = harness?.id === h.id
                  const color = (HARNESS_COLORS as Record<string, string>)[h.id] ?? 'var(--text-secondary)'
                  const name = (HARNESS_LABELS as Record<string, string>)[h.id] ?? h.label
                  return (
                    <button
                      key={h.id}
                      onClick={() => { setHarness(h) }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '9px 13px', borderRadius: 10, cursor: 'pointer',
                        border: `1px solid ${on ? color : 'var(--border-subtle)'}`,
                        background: on ? `color-mix(in srgb, ${color} 14%, transparent)` : 'var(--bg-elevated)',
                        color: on ? 'var(--text-primary)' : 'var(--text-secondary)',
                        fontFamily: 'inherit', fontSize: 13, fontWeight: on ? 650 : 500,
                      }}
                    >
                      <HarnessMark harness={h.id} size={18} />
                      {name}
                    </button>
                  )
                })}
              </div>
            )}
          </Field>

          <Field label={pt ? 'Onde' : 'Where'}>
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <Search size={13} style={{
                position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                color: 'var(--text-tertiary)', pointerEvents: 'none',
              }} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={pt ? 'Buscar projeto ou pasta…' : 'Search project or folder…'}
                style={inputStyle}
              />
            </div>
            <div style={{
              maxHeight: 190, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4,
              border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 6,
            }}>
              {projects.length === 0 ? (
                <Muted text={pt ? 'Nenhuma pasta encontrada.' : 'No folder found.'} />
              ) : projects.map(p => {
                const on = cwd === p.path
                return (
                  <button
                    key={p.path}
                    onClick={() => setCwd(p.path)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                      padding: '8px 10px', borderRadius: 8, border: 'none', minWidth: 0,
                      background: on ? 'var(--anthropic-orange-dim)' : 'transparent',
                      color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {/* A repository and a plain directory are different things, and the mark says
                        which. Read from the store's own answer, never guessed from the path. */}
                    {p.repo
                      ? <FolderGit2 size={15} style={{ color: 'var(--accent-purple)', flexShrink: 0 }} />
                      : <Folder size={15} style={{ color: 'var(--anthropic-orange)', flexShrink: 0 }} />}
                    <span style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 12.5, fontWeight: on ? 650 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.label}
                      </span>
                      <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.repo ? `${p.repo} · ${p.detail}` : p.detail}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </Field>

          <Field label={pt ? 'Tarefa (opcional)' : 'Task (optional)'} hint={pt
            ? 'Agrupa várias sessões como um trabalho só, e é o que permite reabrir todas de uma vez.'
            : 'Groups several sessions as one piece of work, and is what lets you reopen them all at once.'}>
            <input
              value={task}
              onChange={e => setTask(e.target.value)}
              list="agentistics-tasks"
              placeholder={pt ? 'Nova ou existente…' : 'New or existing…'}
              style={{ ...inputStyle, paddingLeft: 12 }}
            />
            <datalist id="agentistics-tasks">
              {tasks.map(t => <option key={t} value={t} />)}
            </datalist>
          </Field>

          {/* SKIPPED, not disabled, when the CLI has no such flag — see the header. */}
          {harness?.supportsModel && (
            <Field label={pt ? 'Modelo (opcional)' : 'Model (optional)'}>
              {/* A CLOSED dropdown, never free text: `modelSuggestions` is the actual set this
                  harness offers, and a typed id it does not recognise fails at spawn with no
                  explanation on screen. The wizard's job is to offer only what will work. */}
              <div style={{ position: 'relative' }}>
                <select
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  style={{ ...inputStyle, paddingLeft: 12, paddingRight: 30, appearance: 'none', cursor: 'pointer' }}
                >
                  <option value="">{pt ? 'Padrão do assistente' : "The assistant's default"}</option>
                  {harness.modelSuggestions.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <ChevronDown size={14} style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  color: 'var(--text-tertiary)', pointerEvents: 'none',
                }} />
              </div>
            </Field>
          )}

          {efforts.length > 0 && (
            <Field label={pt ? 'Esforço (opcional)' : 'Effort (optional)'} hint={pt
              ? 'Mais esforço pensa por mais tempo e custa mais. Sem escolha, usa o padrão do assistente.'
              : 'More effort thinks for longer and costs more. Left unset, the assistant’s default applies.'}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {efforts.map(step => {
                  const on = effort === step.value
                  const color = effortColor(step.intensity)
                  return (
                    <button
                      key={step.value}
                      onClick={() => setEffort(on ? '' : step.value)}
                      className={on && step.peak ? 'ag-effort-peak' : undefined}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 7,
                        padding: '8px 13px', borderRadius: 9, cursor: 'pointer',
                        border: `1px solid ${on ? color : 'var(--border-subtle)'}`,
                        background: on ? `color-mix(in srgb, ${color} 16%, transparent)` : 'var(--bg-elevated)',
                        color: on ? 'var(--text-primary)' : 'var(--text-secondary)',
                        fontFamily: 'inherit', fontSize: 12.5, fontWeight: on ? 650 : 500,
                        transition: 'background 0.15s, border-color 0.15s',
                      }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: color, flexShrink: 0 }} />
                      {step.value}
                    </button>
                  )
                })}
              </div>
            </Field>
          )}

          <Field label={pt ? 'Primeira mensagem (opcional)' : 'First message (optional)'}>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={3}
              placeholder={pt ? 'O que a sessão deve fazer…' : 'What the session should do…'}
              style={{ ...inputStyle, paddingLeft: 12, resize: 'vertical', minHeight: 68 }}
            />
          </Field>

          <Field label={pt ? 'Nome (opcional)' : 'Name (optional)'} hint={pt
            ? 'Sem nome, a sessão usa o que o assistente chamar de si mesmo.'
            : 'With no name, the session uses whatever the assistant calls itself.'}>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder={task || (pt ? 'Derivado' : 'Derived')}
              style={{ ...inputStyle, paddingLeft: 12 }}
            />
          </Field>

          {notice && (
            <p role="status" style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: 'var(--anthropic-orange)' }}>
              {notice}
            </p>
          )}
        </div>

        <footer style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
          padding: '14px 20px', borderTop: '1px solid var(--border)',
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '9px 14px', borderRadius: 9, cursor: 'pointer',
              border: '1px solid var(--border-subtle)', background: 'transparent',
              color: 'var(--text-secondary)', fontFamily: 'inherit', fontSize: 13,
            }}
          >
            {pt ? 'Cancelar' : 'Cancel'}
          </button>
          <button
            onClick={() => void start()}
            disabled={!canStart}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '9px 16px', borderRadius: 9, border: 'none',
              background: canStart ? 'var(--anthropic-orange)' : 'var(--bg-elevated)',
              color: canStart ? '#fff' : 'var(--text-tertiary)',
              cursor: canStart ? 'pointer' : 'default',
              fontFamily: 'inherit', fontSize: 13, fontWeight: 650,
            }}
          >
            {busy && <Loader size={14} />}
            {pt ? 'Iniciar sessão' : 'Start session'}
          </button>
        </footer>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '9px 12px 9px 30px', borderRadius: 9,
  border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
  color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 13, outline: 'none',
}

function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <span style={{
        fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
        color: 'var(--text-tertiary)',
      }}>
        {label}
      </span>
      {children}
      {hint && (
        <span style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-tertiary)' }}>{hint}</span>
      )}
    </div>
  )
}

function Muted({ text }: { text: string }) {
  return <p style={{ margin: 0, padding: '6px 4px', fontSize: 12, lineHeight: 1.5, color: 'var(--text-tertiary)' }}>{text}</p>
}
