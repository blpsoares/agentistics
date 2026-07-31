import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Loader2, Check, AlertTriangle } from 'lucide-react'
import type { SessionMeta, TeamConnection, ModelUsage } from '@agentistics/core'
import Drawer from '../../pages/settings/Drawer'
import { FieldInput } from '../../pages/settings/primitives'
import { useIsMobile } from '../../hooks/useIsMobile'
import { buildShareTargets, buildProjectTargets, hostOf, type ServerProject, type ProjectTarget } from '../../lib/shareRepos'
import { COPY, interpolate } from './copy'
import { SharingRulesPicker } from './SharingRulesPicker'
import { diffDraft, toggleTarget, shareAllDraft, blockAllDraft } from './repoPanelState'
import {
  resolveInitialTab, toggleProjectTarget, shareAllProjectsDraft, blockAllProjectsDraft,
  isEmptyAllowlist, isProjectLocked, partiallyDeniedRepoKeys, resolveSubmittedRules,
  type PickerTab, type ShareMode,
} from './sharePanelState'
import {
  unpackToken, canOpenRules, canConnect, resolveDupeState, computeDirty, buildSubmitBody,
  buildDefaultDraft, type WizardStep, type TestOutcome,
} from './addCentralState'

/**
 * AddCentralDrawer.tsx — the two-step "add a central" wizard (Task 12, design doc §9.6), extended
 * by Plan 4 Tasks 6–7 with the same two-tab Projects/Repositories picker and the mode selector
 * `SharedReposPanel.tsx` uses.
 *
 * Step 1 identifies the central (token/endpoint + a required successful test); step 2 is the SAME
 * picker, defaulted to share-everything. Both steps commit in exactly ONE
 * `POST /api/team/connections` carrying `{ endpoint, token, org, label?, shareMode, sources }` —
 * see `addCentralState.ts`'s docstring for why the connection is never created before the rules
 * are chosen.
 *
 * This file is layout plus fetches: the step machine, the token unpacking, the duplicate/conflict
 * decisions, the dirty computation and the exact submit body all live in `addCentralState.ts` and
 * are unit-tested there.
 */

function actionBtnStyle(isMobile: boolean, variant: 'primary' | 'secondary'): CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: isMobile ? '0 14px' : '8px 14px', minHeight: isMobile ? 44 : undefined,
    width: isMobile ? '100%' : undefined,
    borderRadius: 7, fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
    ...(variant === 'primary'
      ? { border: '1px solid var(--anthropic-orange)', background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)' }
      : { border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)' }),
  }
}

export interface AddCentralDrawerProps {
  open: boolean
  onClose: () => void
  /** Fired once the connection is committed — the caller (`ConnectionsPanel`) refreshes its own
   *  `/api/preferences` read rather than this drawer trying to splice the new connection in by hand. */
  onConnected: () => void
  /** The connections this panel already loaded — the ONLY source `resolveDupeState` may consult;
   *  never re-fetched here, so the duplicate/conflict decision always matches what the list beside
   *  it shows. */
  connections: TeamConnection[]
  /** MUST be the unfiltered session/project lists — same requirement `ConnectionsPanel` documents
   *  for its own `shareTargets` memo: a filtered derivative would silently shrink what step 2 can
   *  even offer to block. */
  sessions: SessionMeta[]
  projects: ServerProject[]
  modelUsage: Record<string, ModelUsage>
  lang: 'pt' | 'en'
}

export function AddCentralDrawer({
  open, onClose, onConnected, connections, sessions, projects, modelUsage, lang,
}: AddCentralDrawerProps) {
  const isMobile = useIsMobile()
  const noRepoLabel = COPY.noRepoTitle[lang]

  const [step, setStep] = useState<WizardStep>('identity')
  const [tokenInput, setTokenInput] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [label, setLabel] = useState('')
  const [test, setTest] = useState<TestOutcome>(null)
  const [testing, setTesting] = useState(false)

  const [draft, setDraft] = useState<Set<string> | null>(null)
  const [projectDraft, setProjectDraft] = useState<Set<string> | null>(null)
  const [mode, setMode] = useState<ShareMode>('denylist')
  const [tab, setTab] = useState<PickerTab>(resolveInitialTab())
  const [rulesTouched, setRulesTouched] = useState(false)
  const [search, setSearch] = useState('')
  const [showStale, setShowStale] = useState(false)
  const [showAllMobile, setShowAllMobile] = useState(false)
  const [showEmptyAllowlistWarning, setShowEmptyAllowlistWarning] = useState(false)

  const [connecting, setConnecting] = useState(false)
  const [connectErr, setConnectErr] = useState<string | null>(null)

  // Computed once from the unfiltered lists, same as ConnectionsPanel's own memo — deniedKeys=[]
  // (share-everything) is the right projection for a brand-new connection's picker.
  const targets = useMemo(
    () => buildShareTargets(sessions, projects, [], { noRepo: noRepoLabel }),
    [sessions, projects, noRepoLabel],
  )
  const projectTargets = useMemo(
    () => buildProjectTargets(sessions, projects, []),
    [sessions, projects],
  )
  const defaultDraft = useMemo(() => buildDefaultDraft(targets), [targets])
  const draftDenied = draft ?? defaultDraft
  const projectDraftDenied = projectDraft ?? new Set<string>()
  const emptyStored = useMemo(() => new Set<string>(), [])
  const diff = diffDraft(draftDenied, emptyStored)
  const projectDiff = diffDraft(projectDraftDenied, emptyStored)
  // The two drafts always mean "this switch is OFF" — the WIRE shape does not (see
  // `resolveSubmittedRules`). Computed ONCE and shared by the empty-allowlist gate and the submit
  // body, exactly as `SharedReposPanel` does: passing the raw drafts into either of them made a
  // wizard-created allowlist store the one repository the user had just switched OFF, and nothing
  // else.
  const submitted = useMemo(
    () => resolveSubmittedRules(mode, targets, projectTargets, draftDenied, projectDraftDenied),
    [mode, targets, projectTargets, draftDenied, projectDraftDenied],
  )
  const partialRepoKeys = useMemo(() => partiallyDeniedRepoKeys(submitted.projectRows), [submitted])

  const bareToken = useMemo(() => unpackToken(tokenInput).token, [tokenInput])
  const dupe = resolveDupeState(connections, endpoint, bareToken)

  function resetTest() {
    setTest(null)
  }

  function handleTokenChange(v: string) {
    setTokenInput(v)
    const unpacked = unpackToken(v)
    if (unpacked.endpoint) setEndpoint(unpacked.endpoint)
    resetTest()
  }
  function handleEndpointChange(v: string) {
    setEndpoint(v)
    resetTest()
  }

  async function runTest() {
    const trimmed = endpoint.trim()
    if (!trimmed) { setTest({ ok: false, error: COPY.addEndpointRequired[lang] }); return }
    setTesting(true)
    setTest(null)
    try {
      const res = await fetch('/api/team/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: trimmed.replace(/\/+$/, ''), token: bareToken }),
      })
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; user?: string; org?: string }
      if (data.ok) setTest({ ok: true, user: data.user ?? '', org: data.org })
      else setTest({ ok: false, error: data.error ?? COPY.couldNotIdentify[lang] })
    } catch (err) {
      setTest({ ok: false, error: err instanceof Error ? err.message : COPY.networkError[lang] })
    } finally {
      setTesting(false)
    }
  }

  function goToRules() {
    if (!canOpenRules(test, dupe)) return
    setStep('rules')
  }
  function backToIdentity() {
    setStep('identity')
  }

  function onToggleRow(target: Parameters<typeof toggleTarget>[1], nextShared: boolean) {
    setDraft(toggleTarget(draftDenied, target, nextShared))
    setRulesTouched(true)
  }
  function onShareAll() {
    setDraft(shareAllDraft(targets))
    setRulesTouched(true)
  }
  function onBlockAll() {
    setDraft(blockAllDraft(targets))
    setRulesTouched(true)
  }
  function onToggleProjectRow(target: ProjectTarget, nextShared: boolean) {
    setProjectDraft(toggleProjectTarget(projectDraftDenied, target, nextShared, isProjectLocked(target, draftDenied)))
    setRulesTouched(true)
  }
  function onShareAllProjects() {
    setProjectDraft(shareAllProjectsDraft(projectTargets))
    setRulesTouched(true)
  }
  function onBlockAllProjects() {
    setProjectDraft(blockAllProjectsDraft(projectTargets))
    setRulesTouched(true)
  }
  function onModeChange(next: ShareMode) {
    setMode(next)
    setShowEmptyAllowlistWarning(false)
    setRulesTouched(true)
  }

  async function handleConnect() {
    if (!canConnect(step, test, dupe) || !test?.ok) return
    if (isEmptyAllowlist(mode, submitted.repoKeys, submitted.projectPaths)) {
      setShowEmptyAllowlistWarning(true)
      return
    }
    setConnecting(true)
    setConnectErr(null)
    const body = buildSubmitBody({
      endpoint, token: bareToken, org: test.org ?? '', label, mode, submitted,
    })
    try {
      const res = await fetch('/api/team/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { setConnectErr(data.error ?? `HTTP ${res.status}`); return }
      onConnected()
      handleClose()
    } catch (err) {
      setConnectErr(err instanceof Error ? err.message : COPY.networkError[lang])
    } finally {
      setConnecting(false)
    }
  }

  function handleClose() {
    setStep('identity')
    setTokenInput('')
    setEndpoint('')
    setLabel('')
    setTest(null)
    setDraft(null)
    setProjectDraft(null)
    setMode('denylist')
    setTab(resolveInitialTab())
    setRulesTouched(false)
    setSearch('')
    setShowEmptyAllowlistWarning(false)
    setConnectErr(null)
    onClose()
  }

  const dirty = computeDirty(tokenInput, endpoint, rulesTouched)

  return (
    <Drawer open={open} title={COPY.addTitle[lang]} onClose={handleClose} dirty={dirty} lang={lang}>
      {step === 'identity' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
            {COPY.addStep1Title[lang]}
          </div>

          <FieldInput
            label={COPY.addTokenLabel[lang]}
            sub={COPY.addTokenSub[lang]}
            value={tokenInput}
            onChange={handleTokenChange}
            type="password"
            placeholder="act1_…"
          />
          <FieldInput
            label={COPY.addEndpointLabel[lang]}
            value={endpoint}
            onChange={handleEndpointChange}
            placeholder="https://central.example.com"
          />
          <FieldInput
            label={COPY.addLabelLabel[lang]}
            sub={COPY.addLabelSub[lang]}
            value={label}
            onChange={setLabel}
          />

          {dupe.kind === 'duplicate' && (
            <InlineNote tone="warn">{COPY.dupCentral[lang]}</InlineNote>
          )}
          {dupe.kind === 'tokenInUse' && (
            <InlineNote tone="error">
              {interpolate(COPY.tokenInUse[lang], { central: hostOf(dupe.existing.endpoint) })}
            </InlineNote>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 4, flexDirection: isMobile ? 'column' : 'row' }}>
            <button
              type="button"
              onClick={() => { void runTest() }}
              disabled={testing || !endpoint.trim()}
              style={{ ...actionBtnStyle(isMobile, 'secondary'), opacity: (testing || !endpoint.trim()) ? 0.5 : 1 }}
            >
              {testing
                ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> {COPY.testingConn[lang]}</>
                : COPY.testConnBtn[lang]}
            </button>
          </div>

          {test && (
            test.ok ? (
              <InlineNote tone="ok">
                {test.org
                  ? interpolate(COPY.testOkIdentity[lang], { user: test.user, org: test.org })
                  : interpolate(COPY.testOkIdentityNoOrg[lang], { user: test.user })}
              </InlineNote>
            ) : (
              <InlineNote tone="error">{test.error}</InlineNote>
            )
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button
              type="button"
              onClick={goToRules}
              disabled={!canOpenRules(test, dupe)}
              style={{ ...actionBtnStyle(isMobile, 'primary'), opacity: canOpenRules(test, dupe) ? 1 : 0.45, cursor: canOpenRules(test, dupe) ? 'pointer' : 'not-allowed' }}
            >
              {COPY.continueBtn[lang]}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {COPY.addStep2Title[lang]}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {COPY.addRulesIntro[lang]}
          </div>

          <SharingRulesPicker
            mode={mode}
            onModeChange={onModeChange}
            tab={tab}
            onTabChange={setTab}
            lang={lang}
            isMobile={isMobile}
            targets={targets}
            projectTargets={projectTargets}
            draftDenied={draftDenied}
            projectDraftDenied={projectDraftDenied}
            diff={diff}
            projectDiff={projectDiff}
            partialRepoKeys={partialRepoKeys}
            search={search}
            onSearch={setSearch}
            showStale={showStale}
            onToggleStale={() => setShowStale(v => !v)}
            showAllMobile={showAllMobile}
            onShowAllMobile={() => setShowAllMobile(true)}
            showEmptyAllowlistWarning={showEmptyAllowlistWarning}
            onToggleRow={onToggleRow}
            onShareAll={onShareAll}
            onBlockAll={onBlockAll}
            onToggleProjectRow={onToggleProjectRow}
            onShareAllProjects={onShareAllProjects}
            onBlockAllProjects={onBlockAllProjects}
          />

          {connectErr && <InlineNote tone="error">{connectErr}</InlineNote>}

          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{COPY.whatIsPushed[lang]}</div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8, flexDirection: isMobile ? 'column-reverse' : 'row' }}>
            <button type="button" onClick={backToIdentity} disabled={connecting} style={actionBtnStyle(isMobile, 'secondary')}>
              {COPY.backBtn[lang]}
            </button>
            <button
              type="button"
              onClick={() => { void handleConnect() }}
              disabled={connecting || !canConnect(step, test, dupe)}
              style={{
                ...actionBtnStyle(isMobile, 'primary'),
                opacity: (connecting || !canConnect(step, test, dupe)) ? 0.5 : 1,
                cursor: (connecting || !canConnect(step, test, dupe)) ? 'not-allowed' : 'pointer',
              }}
            >
              {connecting ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={14} />}
              {COPY.connectBtn[lang]}
            </button>
          </div>
        </div>
      )}
    </Drawer>
  )
}

function InlineNote({ tone, children }: { tone: 'ok' | 'warn' | 'error'; children: ReactNode }) {
  const palette = {
    ok: { bg: 'color-mix(in srgb, var(--accent-green) 12%, transparent)', color: 'var(--accent-green)' },
    warn: { bg: 'color-mix(in srgb, var(--anthropic-orange) 10%, transparent)', color: 'var(--anthropic-orange)' },
    error: { bg: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', color: 'var(--accent-red)' },
  }[tone]
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 7, padding: '8px 10px', borderRadius: 7,
      background: palette.bg, color: palette.color, fontSize: 11.5, lineHeight: 1.5,
    }}>
      {tone === 'error' && <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />}
      <span>{children}</span>
    </div>
  )
}
