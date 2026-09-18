/**
 * SubtaskTable — the subtasks, as the SAME grid the table view expands inside a row.
 *
 * One component drawn in two places, deliberately: a subtask that shows five columns on the board
 * and a checkbox on the detail page is two different records as far as the reader is concerned, and
 * the one with fewer columns teaches people the fields do not exist. (`TaskTable.tsx`'s inline
 * subitem rows mirror the base columns but do NOT yet draw the two below — a gap worth closing
 * there too, tracked separately rather than done as a side effect of this file.)
 *
 * A subtask carries a SESSION — which piece of work is being done where — and now a ROLLUP of its
 * own: cost, rounds and tokens are still measured per SESSION, never stored on the subtask itself,
 * but the server's `subtaskViews()` (`task-report.ts`) sums a subtask's own sessions the same way
 * `attemptViews()` sums an attempt's, as a partition of the task's rows rather than a second count
 * of them — nothing here double-counts a session or invents a split the data does not record. See
 * docs/superpowers/specs/2026-09-10-task-session-hierarchy-design.md §4.2.
 *
 * The Cost/Tokens columns below read `p.subtaskRollups` through `subtaskRollupOf`, which resolves
 * the EFFECTIVE key — a subtask's own id, or its `groupId` when it is one of a group, since the
 * server files a whole group under ONE bucket (see `rollupKeyOf`) — and render them with
 * the exact same formatters `TaskTable.tsx`'s own cost/tokens cells use (`useMoney()`, `fmtTokens`).
 * A subtask with no session filed yet still gets a bucket from the server (`sessionsUsed: 0`, every
 * metric `null`), and that renders as an EMPTY cell — no field at all, not even "N/A" — through
 * `costCellFor`/`tokensCellFor`'s `isUntracked` check: metric tracking starts the moment a session
 * is actually linked, not before. "N/A" is reserved for a session that IS linked but whose figure
 * genuinely cannot be produced. See `subtaskRollup.ts`.
 *
 * The `id: null` direct-branch bucket (sessions filed straight on the delivery, under no subtask —
 * see `task-attach.ts` and docs/superpowers/specs/2026-09-10-task-session-hierarchy-design.md §4.1)
 * is drawn as a FOOTER row below the subtask rows, styled distinctly (no status chip, no due date —
 * it is not a piece of planned work, it is "everything not broken out") and only when the server
 * actually reports one — a task with no direct sessions gets no footer row at all, per §4.4.
 */

import { useState } from 'react'
import { Plus, Rocket, SquarePen, Trash2 } from 'lucide-react'
import type { StagedSessionDraft } from '@agentistics/core'
import { useIsMobile } from '../../hooks/useIsMobile'
import { COLUMN_ORDER, STATUS, fmtTokens, microLabel, numeric, pill, surface, type BoardStatus } from './board'
import { SessionPicker } from './SessionPicker'
import { DoneNeedsSessionDialog } from './DoneNeedsSessionDialog'
import { DatePicker } from '../DatePicker'
import { TaskProgressBar } from './TaskProgressBar'
import { subtaskSessions } from './SubtaskSessions'
import { SubtaskBlockedBy } from './SubtaskBlockedBy'
import { SessionRef } from './SessionRef'
import { StagedSessionCompose } from './StagedSessionCompose'
import { boardCopy, statusLabel, type Lang } from './copy'
import { useMoney, type Money } from './money'
import { costCaveat, costCellFor, subtaskRollupOf, tokensCellFor, type CostCell, type TokensCell } from './subtaskRollup'
import type {
  AttemptRollup, StagedSessionWriteResult, StatusWriteResult, Subtask, SubtaskView, TaskFile,
  TaskSessionRow, TaskStatus,
} from '../../lib/tasks'

function StatusPick({ value, lang, onPick }: {
  value: TaskStatus
  lang: Lang
  onPick: (s: TaskStatus) => void
}) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const s = STATUS[value as BoardStatus] ?? STATUS.todo
  return (
    <div style={{ position: 'relative' }}>
      <button className="ag-tap"
        onClick={() => setOpen(v => !v)}
        style={{
          border: `1px solid ${s.color}`, cursor: 'pointer', padding: '3px 9px', borderRadius: 5,
          background: s.dim, color: s.color, fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap',
        }}
      >{statusLabel(value, lang)}</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
          <div style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 31, marginTop: 4, minWidth: 128,
            ...surface, background: 'var(--bg-elevated)', padding: 4, display: 'grid', gap: 2,
            boxShadow: 'var(--shadow-elevated)',
          }}>
            {COLUMN_ORDER.map(st => {
              const c = STATUS[st]
              return (
                <button
                  // A MENU ROW pays its 44px in PAINT. `.ag-tap` is for controls whose smallness
                  // is their meaning; these sit in a `gap: 2` list, where a projected box covers
                  // the row above and its bottom band selects the row below.
                  key={st} onClick={() => { setOpen(false); onPick(st) }}
                  style={{
                    border: 'none', cursor: 'pointer', textAlign: 'left', padding: '5px 9px',
                    minHeight: isMobile ? 44 : undefined,
                    borderRadius: 5, background: c.dim, color: c.color, fontSize: 10.5, fontWeight: 600,
                  }}
                >{statusLabel(st, lang)}</button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

const cell: React.CSSProperties = { padding: '7px 9px', borderTop: '1px solid var(--border)' }
const bare: React.CSSProperties = {
  width: '100%', background: 'transparent', border: 'none', outline: 'none',
  color: 'var(--text-secondary)', fontSize: 12, fontFamily: 'inherit',
}

/** One rendering for the cost cell — the subtask rows and the direct-sessions footer row draw the
 *  EXACT same figure the exact same way, so this lives once rather than being copy-pasted twice. */
function CostCellView({ r, cost, money }: { r: AttemptRollup | undefined; cost: CostCell; money: Money }) {
  if (cost.kind === 'empty') return null
  if (cost.kind === 'credits') {
    return <span style={{ ...numeric, fontSize: 12 }}>{cost.premiumRequests} req</span>
  }
  return (
    <span
      style={{ ...numeric, fontSize: 12, color: cost.usd === null ? 'var(--text-tertiary)' : 'var(--anthropic-orange)' }}
      title={costCaveat(r)}
    >{money(cost.usd)}</span>
  )
}

/** The tokens column's own version of `CostCellView`. */
function TokensCellView({ tok }: { tok: TokensCell }) {
  if (tok.kind === 'empty') return null
  return (
    <span style={{ ...numeric, fontSize: 12, color: tok.n === null ? 'var(--text-tertiary)' : undefined }}>
      {fmtTokens(tok.n)}
    </span>
  )
}

export interface SubtaskTableProps {
  subtasks: Subtask[]
  /** The DELIVERY's sessions. Each row shows the ones filed under it — see `SubtaskSessions`. */
  sessions: readonly TaskSessionRow[]
  /** One rollup per subtask, plus the `id: null` direct-branch bucket drawn as the footer row —
   *  `TaskDetail.subtaskRollups`, straight off the server's `subtaskViews()`. */
  subtaskRollups: readonly SubtaskView[]
  lang: Lang
  onAdd: (title: string) => void | Promise<void>
  /** Returns the write's outcome — the status pick below needs it to catch `done_needs_session`
   *  and open the resolution dialog, rather than swallow the refusal like every other patch. */
  onPatch: (id: string, patch: Partial<Subtask>) => Promise<StatusWriteResult>
  onRemove: (id: string) => void | Promise<void>
  /** File a session under a subtask. */
  onAttach: (subtaskId: string, sessionId: string) => void | Promise<void>
  /** Take a session out of wherever it is filed. */
  onUnfile: (sessionId: string) => void | Promise<void>
  /** Open a session's own screen. Absent renders the reference as a label. */
  onOpenSession?: (sessionId: string) => void
  /**
   * The staged-session draft (t-918cc82233) — a dormant session composed ahead of time on a loose
   * subtask or a group, fired later. Never offered on a group MEMBER (`isGroupMember`): a member can
   * never hold a session of its own, so a draft that could never be fired there is refused at the
   * same point `task-attach.ts`'s `subtask_in_group` already refuses filing a real one.
   */
  taskFiles: readonly TaskFile[]
  onUploadFile: (file: File) => Promise<string | null>
  onSaveStagedSession: (subtaskId: string, draft: StagedSessionDraft) => Promise<StagedSessionWriteResult>
  onClearStagedSession: (subtaskId: string) => void | Promise<void>
  /** Fire an EXISTING draft — the caller decides the direct-launch-vs-wizard-fallback path (see
   *  `DeliveryDetail`'s `startFire`), since only it holds the navigation this can end in. */
  onFireStagedSession: (subtask: Subtask) => void
  /** The subtask whose attachments are being materialized into real paths right now, so its Fire
   *  button reads busy instead of looking inert during the brief round trip. */
  preparingStagedSessionId?: string | null
}

export function SubtaskTable(p: SubtaskTableProps) {
  const isMobile = useIsMobile()
  const copy = boardCopy(p.lang)
  const money = useMoney()
  const [draft, setDraft] = useState('')
  const [linking, setLinking] = useState<string | null>(null)
  /** Set when a status write refused `done` for having no session filed yet — see
   *  `DoneNeedsSessionDialog`. Named so its shortcut can reopen `SessionPicker` for the SAME row. */
  const [doneRefusal, setDoneRefusal] = useState<{ id: string; title: string } | null>(null)
  /** The subtask/group whose staged-session compose dialog is open — see `StagedSessionCompose`. */
  const [composing, setComposing] = useState<Subtask | null>(null)
  const [stagedError, setStagedError] = useState<string | null>(null)
  const staged = boardCopy(p.lang).staged

  const pickStatus = async (t: Subtask, status: TaskStatus) => {
    const result = await p.onPatch(t.id, { status })
    if (!result.ok && result.reason === 'done_needs_session') {
      setDoneRefusal({ id: t.id, title: t.title })
    }
  }

  const done = p.subtasks.filter(t => t.done).length

  // The direct-branch footer row — sessions filed straight on the delivery, under no subtask.
  // `subtaskRollupOf` only resolves a SUBTASK's bucket (it takes `{ id, groupId }`, never `null`),
  // so the `id: null` view is read straight off the list here instead.
  const directView = p.subtaskRollups.find(v => v.id === null)
  const directSessions = p.sessions.filter(s => s.subtaskId === null)
  const directCost = costCellFor(directView?.rollup)
  const directTok = tokensCellFor(directView?.rollup)

  return (
    <div style={{ ...surface, overflowX: 'auto' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9, padding: '9px 10px',
        borderBottom: '1px solid var(--border)',
      }}>
        <span style={microLabel}>{copy.subtasks}</span>
        {/* The shared bar — it rounds DOWN, so this one cannot say 100% while the grid below it
            still shows an open row. That disagreement is exactly what one component prevents. */}
        <div style={{ flex: 1, maxWidth: 220 }}>
          <TaskProgressBar done={done} total={p.subtasks.length} />
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
        <thead>
          <tr>
            {[copy.subtasks, 'Status', copy.owner, copy.start, copy.due, copy.sessions, copy.cost, copy.tokens, ''].map((h, i) => (
              <th
                key={i}
                style={{
                  ...microLabel, padding: '6px 9px', fontWeight: 600,
                  textAlign: h === copy.cost || h === copy.tokens ? 'right' : 'left',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {p.subtasks.length === 0 && (
            <tr>
              <td colSpan={9} style={{ ...cell, fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.55 }}>
                {copy.nothingBrokenOut}
              </td>
            </tr>
          )}
          {p.subtasks.map(t => {
            const r = subtaskRollupOf(p.subtaskRollups, t)
            const cost = costCellFor(r)
            const tok = tokensCellFor(r)
            return (
            <tr key={t.id}>
              <td style={{ ...cell, minWidth: 180 }}>
                <input
                  defaultValue={t.title}
                  onBlur={e => { if (e.target.value.trim() !== t.title) void p.onPatch(t.id, { title: e.target.value }) }}
                  style={{
                    ...bare,
                    color: t.done ? 'var(--text-tertiary)' : 'var(--text-primary)',
                    textDecoration: t.done ? 'line-through' : 'none',
                    fontSize: 12.5,
                  }}
                />
              </td>
              {/* `minWidth` + `nowrap`: the status chip and the blocked-by badge are two small
                  controls meant to sit on ONE line — without a floor here `table-layout: auto`
                  could squeeze this column below their combined width and wrap the badge onto
                  its own row, which reads as a broken layout rather than two controls. */}
              <td style={{ ...cell, minWidth: 130, whiteSpace: 'nowrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexWrap: 'nowrap' }}>
                  <StatusPick
                    value={t.status} lang={p.lang}
                    onPick={s => void pickStatus(t, s)}
                  />
                  {/* Blockers are SIBLINGS of this same delivery — `p.subtasks` already IS that
                      pool, so no second fetch is needed. */}
                  <SubtaskBlockedBy
                    subtaskId={t.id}
                    blockedBy={t.blockedBy ?? []}
                    siblings={p.subtasks}
                    lang={p.lang}
                    onChange={ids => void p.onPatch(t.id, { blockedBy: ids })}
                  />
                </span>
              </td>
              <td style={cell}>
                <input
                  defaultValue={t.assignee ?? ''} placeholder="—"
                  onBlur={e => { if (e.target.value !== (t.assignee ?? '')) void p.onPatch(t.id, { assignee: e.target.value }) }}
                  style={bare}
                />
              </td>
              {/* The dashboard's own picker, not `<input type="date">`: one calendar in the app,
                  and a control that fits the column instead of overflowing it. The label is empty
                  because the column heading above already says which date this is. */}
              <td style={cell}>
                <DatePicker
                  value={t.startDate ?? ''} label="" placeholder="—" lang={p.lang}
                  onChange={v => void p.onPatch(t.id, { startDate: v })}
                />
              </td>
              <td style={cell}>
                <DatePicker
                  value={t.dueDate ?? ''} label="" placeholder="—" lang={p.lang}
                  min={t.startDate || undefined}
                  onChange={v => void p.onPatch(t.id, { dueDate: v })}
                />
              </td>
              <td style={{ ...cell, minWidth: 190 }}>
                {subtaskSessions({
                  subtaskId: t.id,
                  // The row's group siblings show the identical chip list — see
                  // docs/superpowers/specs/2026-09-11-alm-session-linking-ux.md §B.4.
                  subtaskIds: t.groupId
                    ? p.subtasks.filter(s => s.groupId === t.groupId).map(s => s.id)
                    : [t.id],
                  sessions: p.sessions,
                  lang: p.lang,
                  mobile: isMobile,
                  onLink: setLinking,
                  onUnfile: sid => void p.onUnfile(sid),
                  onOpen: p.onOpenSession,
                })}
              </td>
              {/* `r` absent (no bucket at all) or `sessionsUsed: 0` (a bucket, but nobody has
                  filed a session here yet) both render as a fully EMPTY cell — no field at all,
                  not even "N/A" — via `CostCellView`/`TokensCellView`'s `isUntracked` check. */}
              <td style={{ ...cell, textAlign: 'right' }}>
                <CostCellView r={r} cost={cost} money={money} />
              </td>
              <td style={{ ...cell, textAlign: 'right' }}>
                <TokensCellView tok={tok} />
              </td>
              <td style={{ ...cell, textAlign: 'right' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {/* A group MEMBER can never hold a session of its own (`task-attach.ts`'s
                      `subtask_in_group`), so a draft that could never be fired there is never
                      offered here either — the control is ABSENT, not disabled-and-refusing. */}
                  {!t.parentGroupId && (
                    t.stagedSession ? (
                      <>
                        <span style={{ ...pill('var(--anthropic-orange)'), fontSize: 9.5 }}>{staged.ready}</span>
                        <button
                          onClick={() => p.onFireStagedSession(t)} title={staged.fire}
                          disabled={p.preparingStagedSessionId === t.id}
                          style={{
                            background: 'none', border: 'none', color: 'var(--anthropic-orange)',
                            cursor: p.preparingStagedSessionId === t.id ? 'wait' : 'pointer',
                            display: 'inline-flex', opacity: p.preparingStagedSessionId === t.id ? 0.5 : 1,
                          }}
                        ><Rocket size={13} /></button>
                        <button
                          onClick={() => setComposing(t)} title={staged.edit}
                          style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', display: 'inline-flex' }}
                        ><SquarePen size={12} /></button>
                      </>
                    ) : (
                      <button
                        onClick={() => setComposing(t)} title={staged.compose}
                        style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', display: 'inline-flex' }}
                      ><Rocket size={12} /></button>
                    )
                  )}
                  <button
                    onClick={() => void p.onRemove(t.id)} title={copy.remove}
                    style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', display: 'inline-flex' }}
                  ><Trash2 size={12} /></button>
                </span>
              </td>
            </tr>
            )
          })}
          {directView && (
            // The `id: null` direct-branch bucket — sessions filed straight on the delivery,
            // under no subtask. Styled distinctly from a real subtask row: no status chip, no
            // due date, because this is not a piece of planned work — it is "everything not
            // broken out". See docs/superpowers/specs/2026-09-10-task-session-hierarchy-design.md
            // §4.4. It disappears entirely when there is nothing filed directly (the server only
            // emits this bucket when `direct.length > 0` — see `subtaskViews()`).
            <tr>
              <td style={{ ...cell, minWidth: 180, color: 'var(--text-tertiary)', fontStyle: 'italic', fontSize: 12 }}>
                {copy.directSessions}
              </td>
              <td style={cell} />
              <td style={cell} />
              <td style={cell} />
              <td style={cell} />
              <td style={{ ...cell, minWidth: 190 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', minWidth: 0 }}>
                  {directSessions.map(s => (
                    <SessionRef
                      key={s.id}
                      id={s.id}
                      title={s.label}
                      harness={s.harness}
                      lang={p.lang}
                      onOpen={p.onOpenSession}
                      onUnfile={sid => void p.onUnfile(sid)}
                    />
                  ))}
                </span>
              </td>
              <td style={{ ...cell, textAlign: 'right' }}>
                <CostCellView r={directView.rollup} cost={directCost} money={money} />
              </td>
              <td style={{ ...cell, textAlign: 'right' }}>
                <TokensCellView tok={directTok} />
              </td>
              <td style={cell} />
            </tr>
          )}
          <tr>
            <td colSpan={9} style={{ ...cell }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: '100%' }}>
                <Plus size={12} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                <input
                  value={draft} placeholder={copy.addSubtask}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && draft.trim()) { void p.onAdd(draft.trim()); setDraft('') }
                  }}
                  style={{ ...bare, maxWidth: 340, minHeight: isMobile ? 34 : 20 }}
                />
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      {linking && (
        <SessionPicker
          // MULTIPLE, because a subtask holds any number of sessions — and sequential on the way
          // out, since every attach read-modify-writes the same store.
          onPick={async ids => { for (const id of ids) await p.onAttach(linking, id) }}
          onClose={() => setLinking(null)}
        />
      )}

      {doneRefusal && (
        <DoneNeedsSessionDialog
          title={doneRefusal.title}
          scope="subtask"
          lang={p.lang}
          onCancel={() => setDoneRefusal(null)}
          onFile={() => {
            // The SAME shortcut `SubtaskSessions`' own "filiar" button opens — this row's
            // `SessionPicker`, not a second implementation of it.
            const id = doneRefusal.id
            setDoneRefusal(null)
            setLinking(id)
          }}
        />
      )}

      {composing && (
        <StagedSessionCompose
          lang={p.lang}
          subtaskTitle={composing.title}
          {...(composing.stagedSession ? { initial: composing.stagedSession } : {})}
          taskFiles={p.taskFiles}
          onUpload={p.onUploadFile}
          onSave={async d => {
            const result = await p.onSaveStagedSession(composing.id, d)
            if (!result.ok) {
              // Structurally unreachable through this UI (the control is absent on a member row),
              // but the server is the authority and a network hiccup can still refuse — say so
              // rather than pretending the dialog's close meant success. The compose dialog still
              // closes: what was typed was not saved, and repeating it in a member row would refuse
              // again — this is defence in depth, not a path a person composing from this table can
              // actually reach.
              setStagedError(result.reason === 'subtask_in_group'
                ? (p.lang === 'pt'
                  ? 'Esta subtarefa pertence a um grupo e não pode receber uma sessão em espera.'
                  : 'This subtask belongs to a group and cannot hold a staged session.')
                : staged.networkError)
            }
          }}
          {...(composing.stagedSession
            ? { onDiscard: () => void p.onClearStagedSession(composing.id) }
            : {})}
          onClose={() => setComposing(null)}
        />
      )}

      {stagedError && (
        <div
          role="alertdialog" aria-modal="true"
          onClick={e => { if (e.target === e.currentTarget) setStagedError(null) }}
          style={{
            position: 'fixed', inset: 0, zIndex: 435, background: 'var(--ag-scrim)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14,
            width: '100%', maxWidth: 380, padding: 18, display: 'grid', gap: 12,
          }}>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-primary)', lineHeight: 1.5 }}>
              {stagedError}
            </p>
            <button
              type="button" onClick={() => setStagedError(null)}
              style={{
                justifySelf: 'flex-end', padding: '7px 14px', borderRadius: 7,
                border: '1px solid var(--border)', background: 'transparent',
                color: 'var(--text-secondary)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >OK</button>
          </div>
        </div>
      )}
    </div>
  )
}
