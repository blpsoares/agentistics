/**
 * SessionWizard.tsx — starting a session, one question at a time.
 *
 * Every question the CLI's flags express, asked in the order a person decides them: which assistant,
 * where, which model, how hard to think, what to say first, and whether to take the terminal now.
 * Nothing here knows which CLI takes which flag — the host answers `startableHarnesses()` from the
 * spawn specs, so a harness with no spec is ABSENT rather than offered and failing, and a harness
 * with no model flag is never asked about a model.
 *
 * The `where` step is the one that earns the wizard its place: a search field over the projects and
 * repositories this machine has actually worked in, opening on the directory you are standing in.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type {
  ControlHost, ProjectOption, SessionHarnessOption, SpawnSessionRequest, SpawnSessionResult,
} from '../types'
import type { ControlStrings } from '../i18n'
import { resolveListKey, windowOffset, type NavKey } from '../nav'
import { TextPrompt } from '../Prompt'
import { truncate } from '../../components/Primitives'
import { COLORS } from '../../theme'

/**
 * Where the wizard is.
 *
 * `model` and `effort` are SKIPPED rather than shown-and-disabled when the chosen harness has no
 * such flag: a question whose only answer is "not applicable" is a question that should not have
 * been asked, and `advance` is the single place that decides which ones a harness earns.
 */
type Step = 'harness' | 'where' | 'model' | 'effort' | 'prompt' | 'how'

interface Draft {
  harness?: SessionHarnessOption
  cwd?: string
  model?: string
  effort?: string
  prompt?: string
}

export function SessionWizard({ host, strings: s, width, height, isActive, onCancel, onDone }: {
  host: ControlHost
  strings: ControlStrings
  width: number
  height: number
  isActive: boolean
  onCancel: () => void
  onDone: (result: SpawnSessionResult) => void
}) {
  const [step, setStep] = useState<Step>('harness')
  const [draft, setDraft] = useState<Draft>({})
  const [harnesses, setHarnesses] = useState<SessionHarnessOption[] | null>(null)

  useEffect(() => {
    const read = host.startableHarnesses
    if (!read) return
    let alive = true
    void read.call(host).then(list => { if (alive) setHarnesses(list) })
    return () => { alive = false }
  }, [host])

  /** The next step this harness actually earns, skipping the questions it has no flag for. */
  const nextAfter = useCallback((from: Step, h: SessionHarnessOption | undefined): Step => {
    const order: Step[] = ['harness', 'where', 'model', 'effort', 'prompt', 'how']
    let i = order.indexOf(from) + 1
    while (i < order.length) {
      const candidate = order[i]!
      if (candidate === 'model' && !h?.supportsModel) { i++; continue }
      if (candidate === 'effort' && (h?.efforts.length ?? 0) === 0) { i++; continue }
      return candidate
    }
    return 'how'
  }, [])

  const submit = useCallback((attach: boolean) => {
    const spawn = host.spawnSession
    if (!spawn || !draft.harness || !draft.cwd) return
    const req: SpawnSessionRequest = {
      harness: draft.harness.id,
      cwd: draft.cwd,
      attach,
      ...(draft.model ? { model: draft.model } : {}),
      ...(draft.effort ? { effort: draft.effort } : {}),
      ...(draft.prompt ? { prompt: draft.prompt } : {}),
    }
    void spawn.call(host, req).then(onDone)
  }, [host, draft, onDone])

  // `esc` steps BACK rather than out, until there is nowhere back to go. A wizard that abandons six
  // answers because the sixth was a typo is a wizard people stop using.
  useInput((_input, key) => {
    if (!key.escape) return
    const order: Step[] = ['harness', 'where', 'model', 'effort', 'prompt', 'how']
    const i = order.indexOf(step)
    for (let j = i - 1; j >= 0; j--) {
      const prev = order[j]!
      if (prev === 'model' && !draft.harness?.supportsModel) continue
      if (prev === 'effort' && (draft.harness?.efforts.length ?? 0) === 0) continue
      return setStep(prev)
    }
    onCancel()
  }, { isActive })

  if (step === 'harness') {
    return (
      <Picker
        label={s.wizHarness}
        options={(harnesses ?? []).map(h => ({ key: h.id, label: h.label }))}
        empty={s.sessionsLoading}
        width={width}
        height={height}
        isActive={isActive}
        onPick={key => {
          const h = (harnesses ?? []).find(x => x.id === key)
          setDraft(d => ({ ...d, harness: h }))
          setStep(nextAfter('harness', h))
        }}
      />
    )
  }

  if (step === 'where') {
    return (
      <ProjectSearch
        host={host}
        strings={s}
        width={width}
        height={height}
        isActive={isActive}
        onPick={path => {
          setDraft(d => ({ ...d, cwd: path }))
          setStep(nextAfter('where', draft.harness))
        }}
      />
    )
  }

  if (step === 'model') {
    return (
      <FreeChoice
        label={s.wizModel}
        hint={s.wizModelHint}
        skipLabel={s.wizSkip}
        options={draft.harness?.modelSuggestions ?? []}
        width={width}
        height={height}
        isActive={isActive}
        onPick={value => {
          setDraft(d => ({ ...d, ...(value ? { model: value } : {}) }))
          setStep(nextAfter('model', draft.harness))
        }}
      />
    )
  }

  if (step === 'effort') {
    return (
      <Picker
        label={s.wizEffort}
        // A genuine closed enum printed by the CLI itself, so it is a pick and not a free field.
        options={[
          { key: '', label: s.wizSkip },
          ...(draft.harness?.efforts ?? []).map(e => ({ key: e, label: e })),
        ]}
        empty=""
        width={width}
        height={height}
        isActive={isActive}
        onPick={key => {
          setDraft(d => ({ ...d, ...(key ? { effort: key } : {}) }))
          setStep(nextAfter('effort', draft.harness))
        }}
      />
    )
  }

  if (step === 'prompt') {
    return (
      <Box flexDirection="column" width={width}>
        <Text dimColor>{truncate(s.wizPromptHint, width)}</Text>
        <TextPrompt
          label={s.wizPrompt}
          width={width}
          isActive={isActive}
          onSubmit={value => {
            const text = value.trim()
            setDraft(d => ({ ...d, ...(text ? { prompt: text } : {}) }))
            setStep(nextAfter('prompt', draft.harness))
          }}
          onCancel={() => setStep('where')}
        />
      </Box>
    )
  }

  return (
    <Picker
      label={s.wizHow}
      options={[
        { key: 'bg', label: s.wizBackground },
        { key: 'fg', label: s.wizAttached },
      ]}
      empty=""
      width={width}
      height={height}
      isActive={isActive}
      onPick={key => submit(key === 'fg')}
    />
  )
}

// ---------------------------------------------------------------------------

/** A plain vertical pick. The wizard's default question shape. */
function Picker({ label, options, empty, width, height, isActive, onPick }: {
  label: string
  options: ReadonlyArray<{ key: string; label: string }>
  empty: string
  width: number
  height: number
  isActive: boolean
  onPick: (key: string) => void
}) {
  const [index, setIndex] = useState(0)
  const at = options.length === 0 ? 0 : Math.min(index, options.length - 1)

  useInput((input, key) => {
    if (options.length === 0) return
    if (key.return) return onPick(options[at]!.key)
    const nav: NavKey = { input, upArrow: key.upArrow, downArrow: key.downArrow }
    const next = resolveListKey(nav, at, options.length)
    if (next !== at) setIndex(next)
  }, { isActive })

  // One row for the label, one for the blank under it.
  const page = Math.max(1, height - 2)
  const offset = windowOffset(at, options.length, page)

  return (
    <Box flexDirection="column" width={width}>
      <Text bold>{truncate(label, width)}</Text>
      <Box height={1} />
      {options.length === 0 ? (
        <Text dimColor>{truncate(empty, width)}</Text>
      ) : (
        options.slice(offset, offset + page).map((o, i) => {
          const active = offset + i === at
          return (
            <Text key={o.key || `_${i}`} color={active ? COLORS.accent : undefined} wrap="truncate">
              {active ? '❯ ' : '  '}
              {truncate(o.label, Math.max(1, width - 2))}
            </Text>
          )
        })
      )}
    </Box>
  )
}

/**
 * A pick that also accepts anything typed.
 *
 * The model list is explicitly NOT a validation list — `claude --help` documents `--model` as an
 * alias "or a model's full name", so refusing an unlisted value would reject valid input the day a
 * model ships. Typing therefore beats the list: the moment a character is entered, `enter` submits
 * what was typed rather than what the cursor is on.
 */
function FreeChoice({ label, hint, skipLabel, options, width, height, isActive, onPick }: {
  label: string
  hint: string
  skipLabel: string
  options: readonly string[]
  width: number
  height: number
  isActive: boolean
  onPick: (value: string) => void
}) {
  const [typed, setTyped] = useState('')
  const [index, setIndex] = useState(0)

  const rows = useMemo(() => ['', ...options], [options])
  const at = Math.min(index, Math.max(0, rows.length - 1))

  useInput((input, key) => {
    if (key.return) return onPick(typed.trim() || rows[at]! )
    if (key.backspace || key.delete) { setTyped(v => v.slice(0, -1)); return }
    if (key.upArrow || key.downArrow) {
      const nav: NavKey = { input, upArrow: key.upArrow, downArrow: key.downArrow }
      const next = resolveListKey(nav, at, rows.length)
      if (next !== at) setIndex(next)
      return
    }
    if (key.ctrl || key.meta || key.tab) return
    const printable = [...input].filter(ch => ch >= ' ' && ch !== '\x7f').join('')
    if (printable) setTyped(v => v + printable)
  }, { isActive })

  const page = Math.max(1, height - 3)

  return (
    <Box flexDirection="column" width={width}>
      <Text bold>{truncate(label, width)}</Text>
      <Text dimColor>{truncate(hint, width)}</Text>
      <Text>
        <Text dimColor>{'› '}</Text>
        {typed ? <Text>{truncate(typed, Math.max(1, width - 2))}</Text> : <Text dimColor>…</Text>}
      </Text>
      {rows.slice(0, page).map((o, i) => {
        // While something is typed the list is only a reference — what `enter` submits is the field.
        const active = !typed && i === at
        return (
          <Text key={o || '_skip'} color={active ? COLORS.accent : undefined} dimColor={Boolean(typed)} wrap="truncate">
            {active ? '❯ ' : '  '}
            {truncate(o || skipLabel, Math.max(1, width - 2))}
          </Text>
        )
      })}
    </Box>
  )
}

/**
 * The search field, and the one control that decides where work happens.
 *
 * It opens on results rather than on an empty list: with nothing typed the host returns the places
 * ranked by recency, with the directory you are standing in first. That is the answer most of the
 * time, and it costs one keypress.
 */
function ProjectSearch({ host, strings: s, width, height, isActive, onPick }: {
  host: ControlHost
  strings: ControlStrings
  width: number
  height: number
  isActive: boolean
  onPick: (path: string) => void
}) {
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<ProjectOption[] | null>(null)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const search = host.searchProjects
    if (!search) return
    let alive = true
    void search.call(host, query).then(list => {
      if (!alive) return
      setOptions(list)
      // A new result set means the old position points at something else entirely.
      setIndex(0)
    })
    return () => { alive = false }
  }, [host, query])

  const list = options ?? []
  const at = list.length === 0 ? 0 : Math.min(index, list.length - 1)

  useInput((input, key) => {
    if (key.return) {
      if (list.length > 0) return onPick(list[at]!.path)
      // Nothing matched, but a typed absolute path is still a legitimate answer — the host already
      // checked it exists, so an empty list here means it does not.
      return
    }
    if (key.backspace || key.delete) { setQuery(v => v.slice(0, -1)); return }
    if (key.upArrow || key.downArrow) {
      const nav: NavKey = { input, upArrow: key.upArrow, downArrow: key.downArrow }
      const next = resolveListKey(nav, at, Math.max(1, list.length))
      if (next !== at) setIndex(next)
      return
    }
    if (key.ctrl && input === 'u') { setQuery(''); return }
    if (key.ctrl || key.meta || key.tab) return
    const printable = [...input].filter(ch => ch >= ' ' && ch !== '\x7f').join('')
    if (printable) setQuery(v => v + printable)
  }, { isActive })

  // Label, hint, the field itself.
  const page = Math.max(1, height - 3)
  const offset = windowOffset(at, list.length, page)

  // A folder that was merely FOUND on disk must not read like one you have worked in — the words
  // are the only thing distinguishing them, since both are just a directory name on a row.
  const sourceWord = (o: ProjectOption): string =>
    o.source === 'cwd' ? s.wizSourceCwd
      : o.source === 'typed' ? s.wizSourceTyped
      : o.source === 'history' ? s.wizSourceHistory
      : o.source === 'repo' ? s.wizSourceRepo
      : ''

  return (
    <Box flexDirection="column" width={width}>
      <Text bold>{truncate(s.wizWhere, width)}</Text>
      <Text dimColor>{truncate(s.wizWhereHint, width)}</Text>
      <Text>
        <Text dimColor>{'› '}</Text>
        {query ? <Text>{truncate(query, Math.max(1, width - 2))}</Text> : <Text dimColor>…</Text>}
      </Text>
      {options === null ? (
        <Text dimColor>{s.sessionsLoading}</Text>
      ) : list.length === 0 ? (
        <Text dimColor wrap="truncate">{truncate(s.wizNoMatch, width)}</Text>
      ) : (
        list.slice(offset, offset + page).map((o, i) => {
          const active = offset + i === at
          const word = sourceWord(o)
          // The PATH is what makes two directories of the same name distinguishable, so it is drawn
          // on every row and it is the cell that survives — the name and the provenance word are
          // both guessable from it, and neither of them is a substitute for it.
          const right = `${o.detail}${word ? `   ${word}` : ''}`
          const nameRoom = Math.max(6, width - 2 - right.length - 2)
          return (
            <Text key={o.path} wrap="truncate">
              <Text color={active ? COLORS.accent : undefined}>{active ? '❯ ' : '  '}</Text>
              <Text color={active ? COLORS.accent : undefined} bold={active}>
                {truncate(o.label, nameRoom)}
              </Text>
              <Text dimColor>{`  ${truncate(o.detail, Math.max(1, width - 4 - nameRoom))}`}</Text>
              {word ? <Text dimColor>{`   ${word}`}</Text> : null}
            </Text>
          )
        })
      )}
    </Box>
  )
}
