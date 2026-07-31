/**
 * Setup — the solo / central / member wizard, in the order `server/cli-setup.ts` asks it.
 *
 * The ordering is not cosmetic and is preserved exactly: solo persists the mode and then asks the
 * archive consent; central runs `central.sh init` and only offers boot when the init succeeded;
 * member gathers endpoint → token → org, connects, and only then asks the archive consent and the
 * boot question. Anything that runs before a successful connect would be a preference written for
 * a machine that never joined.
 *
 * It is LINEAR — a form, not a cockpit — but it is drawn in the cockpit's vocabulary. The facts it
 * owns are stated in the same `config` rows the cockpit's config pane uses, under the same word, and
 * they STAY on screen through every step: a wizard that replaced the mode it was about to change
 * with a question about it would be asking the user to remember what they were changing.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { ConfigLine } from '../Chrome'
import { configCells, fitValue, stripScheme } from '../chrome.ts'
import { Intro, introRows, SectionHeader } from '../Surface'
import { setupBodyTop, setupRows } from '../surface.ts'
import { Menu } from '../Menu'
import { ArchiveChoice } from '../ArchiveChoice'
import { ConfirmPrompt, TextPrompt } from '../Prompt'
import { launcherStrings, type ConnectStep } from './Services'
import type { ControlStrings } from '../i18n'
import type { CliLang } from '../lang'
import type { ActionResult, ArchiveMode, ControlHost, ControlStatus, ServiceId } from '../types'
import type { TabChrome } from '../ControlCenter'

/** What happens once the archive question is out of the way — member also offers boot. */
type AfterArchive = 'boot-agentistics' | 'done'

type View =
  | { kind: 'mode' }
  | { kind: 'connect'; step: ConnectStep; endpoint: string; token: string }
  | { kind: 'archive'; suggested: ArchiveMode; then: AfterArchive }
  /** By SERVICE: which unit brings it back is the host's business, not a second vocabulary here. */
  | { kind: 'boot'; service: ServiceId }

/** The intro is prose rather than state, so it is what a short terminal gives up first. */
const INTRO_MIN_HEIGHT = 12

export interface SetupProps {
  host: ControlHost
  status: ControlStatus | null
  strings: ControlStrings
  lang: CliLang
  width: number
  height: number
  isActive: boolean
  run: (fn: () => Promise<ActionResult>) => Promise<ActionResult>
  onChrome: (chrome: TabChrome) => void
}

export function Setup({
  host, status, strings: s, lang, width, height, isActive, run, onChrome,
}: SetupProps) {
  const l = launcherStrings(lang)
  const [view, setView] = useState<View>({ kind: 'mode' })

  const home = useCallback(() => setView({ kind: 'mode' }), [])

  useEffect(() => {
    if (!isActive) return
    const capturing = view.kind !== 'mode'
    // Same order and the same keys as the cockpit, `r` included — it works here (the shell owns it)
    // and a footer that omits it made two screens of one application disagree about what a key does.
    onChrome({
      capture: capturing,
      hints: capturing
        ? [s.keyBack, s.keyMove, s.keySelect]
        : [s.keyQuit, s.keyTabs, s.keyMove, s.keySelect, s.keyRefresh],
    })
  }, [isActive, view.kind, onChrome, s])

  /**
   * The consent gate, asked at most once — `ensureArchiveModeChosen()`'s rule, enforced by the
   * host: `pendingArchiveMode()` answers `null` when there is nothing left to ask, and we move
   * straight on rather than putting the same question in front of someone who already answered it.
   */
  const askArchive = useCallback(async (then: AfterArchive) => {
    const pending = await host.pendingArchiveMode().catch(() => null)
    if (pending === null) {
      if (then === 'boot-agentistics') return setView({ kind: 'boot', service: 'agentistics' })
      return home()
    }
    setView({ kind: 'archive', suggested: pending, then })
  }, [host, home])

  const onMode = useCallback((value: string) => {
    if (value === 'solo') {
      return void run(() => host.setMode('solo')).then(res => {
        if (res.ok) void askArchive('done')
        else home()
      })
    }
    if (value === 'central') {
      return void run(() => host.initCentral()).then(res => {
        // A central that failed to initialise must not be offered as a boot service.
        setView(res.ok ? { kind: 'boot', service: 'central' } : { kind: 'mode' })
      })
    }
    return setView({ kind: 'connect', step: 'endpoint', endpoint: '', token: '' })
  }, [host, run, askArchive, home])

  const onConnect = useCallback((step: ConnectStep, endpoint: string, token: string, value: string) => {
    if (step === 'endpoint') return setView({ kind: 'connect', step: 'token', endpoint: value, token: '' })
    if (step === 'token') return setView({ kind: 'connect', step: 'org', endpoint, token: value })
    return void run(() => host.connect({ endpoint, token, org: value })).then(res => {
      if (res.ok) void askArchive('boot-agentistics')
      else home()
    })
  }, [host, run, askArchive, home])

  const onArchive = useCallback((mode: ArchiveMode, then: AfterArchive) => {
    // No local echo of the answer: `run` refreshes the status, and the HISTORY row above reads it
    // from there — one place stating the setting instead of two that can disagree.
    void run(() => host.setArchiveMode(mode)).then(() => {
      if (then === 'boot-agentistics') setView({ kind: 'boot', service: 'agentistics' })
      else home()
    })
  }, [host, run, home])

  const onBoot = useCallback((service: ServiceId, yes: boolean) => {
    if (!yes) return home()
    return void run(() => host.enableBoot(service)).then(home)
  }, [host, run, home])

  // The facts this screen owns, in the cockpit's own row: same labels, same alignment, same
  // truncation rules. `endpoint` appears only in member mode, where it is half of what "member"
  // means and was previously visible on the Services screen alone.
  const rows = [
    { key: 'mode', label: s.modeLabel, value: status?.mode ?? '—', short: status?.mode ?? '—' },
    ...(status?.endpoint
      ? [{
          key: 'endpoint',
          label: s.endpointLabel,
          value: status.endpoint,
          short: stripScheme(status.endpoint),
        }]
      : []),
    {
      key: 'history',
      label: s.historyLabel,
      value: status?.archiveMode ?? s.archiveUnset,
      short: status?.archiveMode ?? s.archiveUnset,
    },
  ]
  const cells = configCells(rows.map(r => r.label), width)

  const intro = height >= INTRO_MIN_HEIGHT ? s.setupIntro : undefined
  // Two headers, the facts, and the blank row that separates them — but only the ones the height can
  // afford. `setupRows` decides that, and the reason it has to is that Ink composites an overflow
  // instead of clipping it: counting a row that is not there painted the `CONFIG` rule straight
  // through the `mode` row on any terminal of twelve rows or fewer.
  const introHeight = introRows(intro, width)
  const budget = setupRows(height, introHeight, rows.length)
  const bodyHeight = budget.body
  /**
   * Where the STEP starts inside this screen's pane — the offset a click has to be measured from.
   *
   * Derived from the very budget that decided which pieces survive, because every row above the step
   * is optional: on a short terminal the intro goes, then the config block whole, then the blank
   * between them. A constant here would answer the second mode when the third was clicked.
   */
  const bodyTop = { x: 0, y: setupBodyTop(budget, introHeight) }

  /**
   * The step's own header.
   *
   * A wizard that headed every step "SETUP" would leave the user to infer from the question alone
   * which of the three answers they picked two keypresses ago. The words are the ones the rest of
   * the app already uses for the same things — the connect item, the history label — so the screen
   * never invents a vocabulary of its own.
   */
  const stepTitle =
    view.kind === 'connect' ? l.itemConnect
    : view.kind === 'archive' ? s.historyLabel
    : s.setupLabel

  return (
    // `flexShrink={0}`: Ink shrinks a Box by default, and a column taller than the pane around it
    // is composited rather than cut. The budget above is what keeps that from happening; this is
    // what makes a miscount degrade into a missing row instead of a corrupted one.
    <Box flexDirection="column" width={width} flexShrink={0}>
      {budget.intro && intro ? <Intro text={intro} width={width} /> : null}

      {budget.configHeader ? <SectionHeader title={s.paneConfig.toUpperCase()} width={width} /> : null}
      {rows.slice(0, budget.configRows).map(row => (
        <ConfigLine
          key={row.key}
          label={row.label}
          // The long form when the column can hold it whole, the short one when it cannot —
          // "http://198.51.100.199:48080" degrades to the host and port, never to a prefix.
          value={fitValue(row.value, row.short, cells.value)}
          cells={cells}
          selected={false}
          focused={false}
        />
      ))}
      {budget.gap ? <Text> </Text> : null}

      {budget.stepHeader ? <SectionHeader title={stepTitle.toUpperCase()} width={width} /> : null}

      {view.kind === 'mode' && (
        <Menu
          items={[
            { label: s.setupSolo, value: 'solo', hint: s.setupSoloHint },
            { label: s.setupCentral, value: 'central', hint: s.setupCentralHint },
            { label: s.setupMember, value: 'member', hint: s.setupMemberHint },
          ]}
          onSelect={onMode}
          width={width}
          isActive={isActive}
          height={bodyHeight}
          origin={bodyTop}
        />
      )}

      {view.kind === 'connect' && (
        <TextPrompt
          key={view.step}
          label={view.step === 'endpoint' ? l.promptEndpoint : view.step === 'token' ? l.promptToken : l.promptOrg}
          secret={view.step === 'token'}
          defaultValue={view.step === 'org' ? l.orgDefault : undefined}
          onSubmit={value => onConnect(view.step, view.endpoint, view.token, value)}
          onCancel={() => {
            // One level at a time, so a mistyped token does not throw away the endpoint.
            if (view.step === 'org') return setView({ ...view, step: 'token' })
            if (view.step === 'token') return setView({ ...view, step: 'endpoint' })
            return home()
          }}
          width={width}
          isActive={isActive}
        />
      )}

      {view.kind === 'archive' && (
        <ArchiveChoice
          strings={s}
          suggested={view.suggested}
          onPick={mode => onArchive(mode, view.then)}
          onCancel={home}
          width={width}
          height={bodyHeight}
          isActive={isActive}
          origin={bodyTop}
        />
      )}

      {view.kind === 'boot' && (
        <ConfirmPrompt
          label={s.bootQuestion}
          yesLabel={s.yes}
          noLabel={s.no}
          onAnswer={yes => onBoot(view.service, yes)}
          onCancel={home}
          width={width}
          height={bodyHeight}
          isActive={isActive}
          origin={bodyTop}
        />
      )}
    </Box>
  )
}
