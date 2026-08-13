/**
 * Chrome.tsx — the frame that stays on screen for the whole control-center session.
 *
 * These components hold no layout arithmetic of their own: every width decision comes from
 * `chrome.ts`, and every user-visible word from `controlStrings(lang)` or from the host, which
 * localizes before it hands anything over. What is left here is placement and color.
 */

import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { COLORS } from '../theme'
import { truncate } from '../components/Primitives'
import { brandMark } from '../components/Wordmark'
import {
  ACTION_SEP,
  detailPlan,
  fitActionRow,
  fitDetailLines,
  footerHints,
  headerMetaWidth,
  tabUnderline,
  type ConfigCells,
  type DetailLine,
  type DetailTone,
  type HeaderLayout,
  type HeaderMeta,
  type TabSpec,
  type TabStripLayout,
} from './chrome.ts'
import { SectionHeader } from './Surface'
import type { ServiceState, TabId } from './types'
import type { ControlStrings } from './i18n'

/**
 * The title: the two-line block wordmark, with the machine's identity right-aligned on its LAST
 * line — or, on a terminal too narrow for both, the one-line mark with the same tag beside it.
 *
 * The shared baseline is the whole point of the arrangement. The original banner put three ragged
 * right-aligned lines beside two lines of art that started at a different row and ended at another,
 * so the two halves read as things that had been placed near each other rather than as one header.
 * Sitting the tag on the art's second row gives them one line to agree on.
 *
 * Which branch is drawn is decided by `headerLayout`, in the pure module, from the MEASURED art and
 * the measured tag — this component chooses nothing. The mode SENTENCE is not here either, only the
 * short token (`solo` / `central` / `member`): in member mode this row once read "member — sends
 * metrics to a central · http://198.51.100.199:48080" and wrapped, which shears every row below it.
 *
 * In the compact branch the MARK's columns are reserved before the tag is fitted, and `brandMark`
 * takes what that left. Both are total and neither can exceed what it was given, so the row cannot
 * wrap. Without the reservation the tag was fitted against the whole row and the mark got the
 * remainder, which in Portuguese member mode at twenty-eight columns was zero — a title row naming
 * the version and not the application.
 */
export function Header({ layout, width }: { layout: HeaderLayout; width: number }) {
  if (layout.kind === 'art') {
    const last = layout.art.length - 1
    return (
      <Box flexDirection="column" width={width} flexShrink={0}>
        {layout.art.map((line, row) => (
          row === last ? (
            <Box key={row} flexDirection="row" width={width} justifyContent="space-between">
              <Text color={COLORS.accent}>{line}</Text>
              <HeaderTag meta={layout.meta} />
            </Box>
          ) : (
            <Text key={row} color={COLORS.accent}>{line}</Text>
          )
        ))}
      </Box>
    )
  }

  const brand = brandMark(Math.max(0, width - headerMetaWidth(layout.meta) - 1))
  return (
    <Box flexDirection="row" width={width} justifyContent="space-between">
      {/* The MARK is the only colored part of the title: the name is a name, in the text color
          every other title in the app wears. */}
      <Text>
        <Text color={COLORS.accent}>{brand.mark}</Text>
        {brand.word ? <Text bold color={COLORS.text}>{` ${brand.word}`}</Text> : null}
      </Text>
      <HeaderTag meta={layout.meta} />
    </Box>
  )
}

/**
 * The machine's identity: mode, version, how many sessions are waiting, and the update dot. The
 * same run in both header branches.
 *
 * The attention count is `COLORS.info`, which is the tone `SESSION_STATE_TONE` already gives the two
 * waiting states — one colour for "this is waiting on you" wherever it appears — and it carries a
 * NUMBER and a WORD, never a bare glyph, so it survives a terminal that flattens the palette.
 */
function HeaderTag({ meta }: { meta: HeaderMeta }) {
  return (
    <Text>
      <Text dimColor>{meta.text}</Text>
      {meta.attention ? <Text color={COLORS.info}>{` · ${meta.attention}`}</Text> : null}
      {/* Glyph plus version, in accent: the dot alone would carry the whole message in color. */}
      {meta.update ? <Text color={COLORS.accent}>{` · ${meta.update}`}</Text> : null}
    </Text>
  )
}

/** The bar's cells, in `TAB_ORDER`, under their short lowercase names. */
export function tabBarTabs(order: readonly TabId[], short: Record<TabId, string>): TabSpec[] {
  return order.map(id => ({ id, label: short[id] }))
}

/**
 * The screens, on a bar at the TOP, with an accent rule under the one you are on.
 *
 * It was a numbered strip at the bottom, which put the answer to "where am I" below the thing it
 * described and made the screens something you reach by translating a name into a digit. Up here
 * the reading order is the one the eye already uses: title, where-am-I, content, keys — and the
 * digits are gone entirely, so `←`/`→` is the whole story.
 *
 * The underline is a ROW rather than the terminal's underline attribute (see `tabUnderline`), and
 * it is drawn from the same cell widths `fitTabs` measured, so the rule cannot drift off its cell.
 *
 * The layout arrives already fitted rather than being measured here, because the SHELL also resolves
 * a click against those same cell widths. Two measurements of one row would agree on the day they
 * were written; the failure afterwards is a click that switches to the tab beside the one under the
 * pointer, which nobody would read as a layout bug.
 */
export function TabBar({ layout, width, dim }: {
  layout: TabStripLayout
  width: number
  /** True while a question owns the keyboard, when `←`/`→` do not change screen. */
  dim?: boolean
}) {
  const rule = tabUnderline(layout)

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      {layout.kind === 'collapsed' ? (
        <Text>
          <Text dimColor>{layout.hasPrev ? '‹ ' : '  '}</Text>
          <Text bold={!dim} color={dim ? undefined : COLORS.accent} dimColor={dim}>{layout.label}</Text>
          <Text dimColor>{layout.hasNext ? ' ›' : '  '}</Text>
        </Text>
      ) : (
        <Box flexDirection="row" width={width}>
          {layout.cells.map(cell => (
            <Box key={cell.id} marginRight={1}>
              <Text
                bold={cell.active && !dim}
                dimColor={!cell.active || dim}
                color={cell.active && !dim ? COLORS.accent : undefined}
              >
                {` ${cell.label} `}
              </Text>
            </Box>
          ))}
        </Box>
      )}
      <Text color={dim ? COLORS.border : COLORS.accent}>{rule}</Text>
    </Box>
  )
}

/** The keys valid on the CURRENT screen — the caller decides which, ordered most-important-first. */
export function Footer({ hints, width }: { hints: string[]; width: number }) {
  return <Text dimColor>{footerHints(hints, width)}</Text>
}

/**
 * The outcome of the last action, in place of a printed line.
 *
 * Always one row tall, even with nothing to say: a status line that appears and disappears would
 * shift every row under it, and the eye reads that as the screen redrawing rather than as an
 * answer to what was just pressed.
 */
export function StatusLine({ message, ok, width }: {
  message?: string
  ok?: boolean
  width: number
}) {
  if (!message) return <Text> </Text>
  const color = ok === undefined ? undefined : ok ? COLORS.success : COLORS.danger
  return (
    <Text color={color} dimColor={ok === undefined}>
      {truncate(`${ok === false ? '✗' : ok === true ? '✓' : '·'} ${message}`, width)}
    </Text>
  )
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

/** Braille spinner for anything slower than a redraw — service detection, docker, connect. */
export function Spinner({ label }: { label?: string }) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % FRAMES.length), 80)
    // Ink keeps the process alive for any pending timer, so a leaked interval means `q` appears
    // to do nothing: the app unmounts and the terminal sits there.
    return () => clearInterval(id)
  }, [])
  return (
    <Text>
      <Text color={COLORS.accent}>{FRAMES[frame]}</Text>
      {label ? <Text dimColor>{` ${label}`}</Text> : null}
    </Text>
  )
}

/**
 * Color never carries the meaning alone — the glyph and the word say it too, for the colorblind
 * and for terminals that flatten the palette. `unknown` is deliberately not `down`: detection
 * failing (no docker, no lsof) is not evidence that the service is stopped.
 *
 * The conflict is not a `ServiceState` — a service running twice is still `up` — so it has a glyph
 * of its own here rather than a fourth state nobody can be in.
 */
export const STATE_GLYPH: Record<ServiceState, string> = { up: '●', down: '○', unknown: '?' }
export const STATE_COLOR: Record<ServiceState, string> = {
  up: COLORS.success,
  down: COLORS.muted,
  unknown: COLORS.info,
}
export const CONFLICT_GLYPH = '▲'

export function stateWord(state: ServiceState, strings: ControlStrings): string {
  return state === 'up' ? strings.stateUp : state === 'down' ? strings.stateDown : strings.stateUnknown
}

/**
 * One row of the cockpit's services pane: cursor, name, runtime, state.
 *
 * One row per LOGICAL service, up or down. A stopped one is DIMMED rather than hidden: hiding it
 * would turn "start the central" into a hunt through a menu, while dimming says the same thing the
 * glyph does — this is here, and it is not running.
 *
 * Every cell width is handed in, measured across the whole list at once by `serviceCells` — a row
 * that measures itself is a column that wobbles as the selection moves. Padded by hand inside one
 * `Text` rather than laid out as fixed-width Boxes: Yoga shrinks a fixed width when a sibling is
 * long enough to wrap, which slides the columns left on exactly the rows with the most to say.
 */
export function ServiceLine({ label, runtime, state, word, conflict, selected, focused, cells }: {
  label: string
  /**
   * The runtime the service is actually using — `native`, `docker`, or both joined when they are in
   * conflict. Empty when it is not running, or when the row is too narrow to carry the cell.
   */
  runtime: string
  state: ServiceState
  /** The state in words. Dropped whole when the cell has room for the glyph only. */
  word: string
  /**
   * More than one runtime of this service is up.
   *
   * It is drawn as danger, with its own glyph AND its own word, because it is the one thing on this
   * screen the user must not be shown half of: the two copies read the same files and fight over
   * the same port. The full sentence is in the detail pane; this is the flag on the row.
   */
  conflict?: boolean
  selected: boolean
  /**
   * The services pane has the keyboard.
   *
   * The cursor is drawn either way — the detail and log panes are views OF this selection, so
   * hiding it would leave two panes describing a row nothing points at — but it is only ACCENT
   * while this pane is the one answering keys. Accented on an unfocused pane it is a second live
   * cursor beside the action row's, and the only thing distinguishing them is a border colour.
   */
  focused?: boolean
  cells: { label: number; runtime: number; state: number }
}) {
  const glyph = conflict ? CONFLICT_GLYPH : STATE_GLYPH[state]
  const color = conflict ? COLORS.danger : STATE_COLOR[state]
  // A stopped row recedes, but never the cursor on it: a dim selection is a selection you cannot
  // find, and this list is what drives the other two panes.
  const quiet = state !== 'up' && !selected
  // A one-column state cell is the GLYPH, never a truncated word: `truncate('● up', 1)` is `…`,
  // which says less than nothing — the glyph alone still tells you the service is running.
  const stateText = cells.state > glyph.length + 1
    ? truncate(`${glyph} ${word}`, cells.state)
    : glyph

  return (
    <Text>
      <Text color={selected && focused ? COLORS.accent : undefined} dimColor={selected && !focused}>
        {selected ? '❯ ' : '  '}
      </Text>
      <Text color={quiet ? undefined : COLORS.text} dimColor={quiet} bold={selected && focused}>
        {truncate(label, cells.label).padEnd(cells.label)}
      </Text>
      {cells.runtime > 0
        ? (
          <Text color={conflict ? COLORS.danger : undefined} dimColor={!conflict}>
            {' ' + truncate(runtime, cells.runtime).padEnd(cells.runtime)}
          </Text>
        )
        : null}
      {/* Color never carries the meaning alone — the glyph says it too, for a flattened palette. */}
      <Text color={color}>{' ' + stateText}</Text>
    </Text>
  )
}

/**
 * One row of the config pane: an aligned label, its value, and — on the focused row — the verb
 * `enter` would run.
 *
 * The verb is what makes the pane a control rather than a readout. Without it the config pane is
 * four facts with a cursor on them and no way to guess that `enter` on `history` re-opens the
 * consent question; the footer can only say "enter select", which does not say select WHAT.
 */
export function ConfigLine({ label, value, verb, cells, selected, focused }: {
  label: string
  value: string
  /** Already-localized, and empty when the row does nothing. */
  verb?: string
  cells: ConfigCells
  selected: boolean
  focused: boolean
}) {
  // The verb is only offered while the pane HAS the keyboard: shown on an unfocused pane it would
  // advertise a key that is currently doing something else entirely. It also comes out of the
  // VALUE's column, so a pane too narrow to hold both keeps the value — the verb is discoverable
  // again one `tab` away, and the footer still names the key.
  const wanted = focused && selected && verb ? verb : ''
  const shownVerb = wanted && cells.value - wanted.length - 2 >= CONFIG_VERB_FLOOR ? wanted : ''
  const room = Math.max(1, cells.value - (shownVerb ? shownVerb.length + 2 : 0))

  return (
    <Text>
      <Text color={selected && focused ? COLORS.accent : undefined}>
        {selected && focused ? '❯ ' : '  '}
      </Text>
      <Text dimColor>{truncate(label, cells.label).padEnd(cells.label)}</Text>
      <Text color={COLORS.text} bold={selected && focused}>{' ' + truncate(value, room)}</Text>
      {shownVerb ? <Text color={COLORS.accent}>{'  ' + shownVerb}</Text> : null}
    </Text>
  )
}

/** What the value keeps when a verb shares its column; below it the verb is not worth the room. */
const CONFIG_VERB_FLOOR = 4

/**
 * The detail pane's action row: the verbs that apply to whatever the services list has selected.
 *
 * A horizontal row rather than a menu because the actions belong to the thing above them — you are
 * already standing on the target, which is the whole reason the old "Stop which?" submenu could be
 * deleted. `fitActions` guarantees the selected verb stays inside the visible window even when the
 * row has to drop the others: a cursor you cannot see, on a row that stops a server, is the one
 * place in this app where a layout compromise could destroy something.
 */
export function ActionRow({ labels, selected, focused, width }: {
  labels: string[]
  selected: number
  focused: boolean
  width: number
}) {
  const { labels: shown, from, less, more } = fitActionRow(labels, selected, width)
  if (shown.length === 0) return null

  return (
    <Text>
      <Text color={focused ? COLORS.accent : undefined}>{focused ? '❯ ' : '  '}</Text>
      {/* The marks are the only thing saying the row is a WINDOW — without them a start option that
          did not fit is a start option the user has no reason to believe exists. */}
      {less ? <Text dimColor>{'‹ '}</Text> : null}
      {shown.map((label, i) => {
        const active = from + i === selected
        return (
          <Text key={label}>
            {i > 0 ? ACTION_SEP : ''}
            <Text
              color={active && focused ? COLORS.accent : undefined}
              bold={active && focused}
              // Unfocused, the row is a list of what is POSSIBLE, not a cursor — dimming it keeps
              // the pane from competing with whichever pane actually has the keyboard.
              dimColor={!focused}
              underline={active && focused}
            >
              {label}
            </Text>
          </Text>
        )
      })}
      {more ? <Text dimColor>{' ›'}</Text> : null}
    </Text>
  )
}

/** Tone → colour. The one place a `DetailTone` becomes a colour, so the mapping cannot drift. */
const TONE_COLOR: Record<DetailTone, string | undefined> = {
  plain: COLORS.text,
  muted: undefined,
  good: COLORS.success,
  bad: COLORS.danger,
  info: COLORS.info,
}

/**
 * What a detail pane draws: the composed lines and the label column they align on.
 *
 * Narrower than `DetailContent` on purpose. A service's content also carries an `alert` — the
 * two-copies-fighting-over-one-port sentence — which is already IN `lines` by the time it reaches
 * here, and a session has no such fact at all. Taking only the two fields this component reads is
 * what lets `detailContent` and `sessionDetailLines` feed the same pane rather than two copies of
 * it, each with its own idea of what a tone looks like.
 */
export interface DetailPaneContent {
  lines: DetailLine[]
  labelWidth: number
}

/**
 * The detail pane's rows, budgeted by `detailPlan` so the ACTION row is the last thing to go and
 * sits on the pane's floor.
 *
 * A pane that dropped its verbs and kept a URL would be a readout; the reason the actions live here
 * rather than in a menu of their own is that they belong to the thing described above them.
 *
 * The lines arrive already composed and already ordered by whichever builder produced them, in the
 * order they must survive a short pane — for a service the ALERT leads, for a session its STATE
 * does, because a pane with one fact row must not spend it on `native · pid 48213 · up 2h14m` while
 * the same program is running twice, nor on a directory while the session is waiting to be let
 * through. This component maps a `kind` to a shape and a `tone` to a colour, and decides nothing.
 */
export function DetailBody({ content, actions, actionIndex, focused, width, rows }: {
  content: DetailPaneContent | null
  actions: string[]
  actionIndex: number
  focused: boolean
  width: number
  rows: number
}) {
  if (!content) return null

  const labelWidth = content.labelWidth
  // Cut to the rows this pane has BEFORE the plan is drawn up, so a slice that landed on a section
  // rule takes the rule with it — see `fitDetailLines`. The action row's own row is reserved here
  // because `detailPlan` will spend it either way.
  const shown = fitDetailLines(content.lines, Math.max(0, rows - (actions.length > 0 ? 1 : 0)))
  const facts = shown.map((line, i) => {
    const key = `${line.kind}${i}`
    if (line.kind === 'blank') return <Text key={key}> </Text>
    // The same titled rule the linear screens use, so a section reads the same everywhere in the
    // app — and it is what turns a dozen facts into four things you can find with your eye.
    if (line.kind === 'section') return <SectionHeader key={key} title={line.label} width={width} />
    if (line.kind === 'text') {
      return (
        <Text key={key} color={TONE_COLOR[line.tone]} dimColor={line.tone === 'muted'}>
          {truncate(line.value, width)}
        </Text>
      )
    }
    return (
      <Text key={key}>
        <Text dimColor>{truncate(line.label, labelWidth).padEnd(labelWidth)}</Text>
        <Text color={TONE_COLOR[line.tone]}>
          {' ' + truncate(line.value, Math.max(1, width - labelWidth - 1))}
        </Text>
      </Text>
    )
  })

  const plan = detailPlan(rows, facts.length, actions.length > 0)

  return (
    <>
      {facts.slice(0, plan.facts)}
      {/* Air between the facts and a row that stops a server — and it is the pane's slack, not a
          single separator row: this pane owns everything under the band, so on a tall terminal it
          has rows to spare. Under the verbs they read as a dead region; over them they read as air,
          and the verbs stop moving as the selection changes. */}
      {Array.from({ length: plan.pad }, (_, i) => <Text key={`pad${i}`}> </Text>)}
      {plan.actions
        ? <ActionRow labels={actions} selected={actionIndex} focused={focused} width={width} />
        : null}
    </>
  )
}

/**
 * One row of the sessions list: cursor, state, harness, name, directory.
 *
 * The cell widths are handed in, measured across the whole fleet at once by `sessionCells` — a row
 * that measured itself would be a column that wobbles as the cursor moves — and the NAME comes from
 * `sessionName`, the same function that measured the column.
 *
 * Two differences from `ServiceLine`, both deliberate:
 *
 *  - There is NO GLYPH. A service has three states and a `●`/`○`/`?` vocabulary that still says
 *    running-or-not; a session has seven, and no glyph tells "needs approval" from "the frame could
 *    not be read". The word is the state, which is why `sessionCells` keeps it last and whole.
 *  - The DIRECTORY is cut from the LEFT. A path's tail is what identifies it — `…/agentop-sessions`
 *    names a worktree, `/home/mithrandir/…` names a home directory every row shares.
 */
export function SessionLine({ word, tone, harness, name, cwd, selected, focused, cells }: {
  /** The state in WORDS, already localized. Never dropped — see `sessionCells`. */
  word: string
  /** How the state is painted. Emphasis only: the word beside it carries the meaning. */
  tone: DetailTone
  harness: string
  name: string
  cwd: string
  selected: boolean
  /** The list has the keyboard. The cursor is drawn either way — the detail pane is a view OF it. */
  focused?: boolean
  cells: { state: number; harness: number; name: number; cwd: number }
}) {
  // A row nothing is asking of recedes, but never the cursor on it: a dim selection is a selection
  // you cannot find, and this list is what drives the pane beside it.
  const quiet = tone === 'muted' && !selected
  const cell = (text: string, width: number) => truncate(text, width).padEnd(width)

  return (
    <Text>
      <Text color={selected && focused ? COLORS.accent : undefined} dimColor={selected && !focused}>
        {selected ? '❯ ' : '  '}
      </Text>
      {/* Colour never carries the meaning alone — the word says it too, for a flattened palette. */}
      <Text color={TONE_COLOR[tone]} dimColor={tone === 'muted'}>{cell(word, cells.state)}</Text>
      {cells.harness > 0 ? <Text dimColor>{' ' + cell(harness, cells.harness)}</Text> : null}
      {cells.name > 0
        ? (
          <Text color={quiet ? undefined : COLORS.text} dimColor={quiet} bold={selected && focused}>
            {' ' + cell(name, cells.name)}
          </Text>
        )
        : null}
      {cells.cwd > 0 ? <Text dimColor>{' ' + cell(truncateStart(cwd, cells.cwd), cells.cwd)}</Text> : null}
    </Text>
  )
}

/**
 * `truncate`'s mirror: keep the END of the string.
 *
 * Only paths use it, and only because a path is identified by its tail. Cutting a directory the way
 * every other cell is cut turns four different worktrees into four rows reading `/home/mithran…`.
 */
export function truncateStart(text: string, max: number): string {
  if (max <= 0) return ''
  if (text.length <= max) return text
  if (max === 1) return '…'
  return '…' + text.slice(text.length - (max - 1))
}

