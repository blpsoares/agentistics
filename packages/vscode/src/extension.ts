/**
 * extension.ts — activation, and the wiring between the pieces.
 *
 * This extension is a CLIENT of the local `agentop server` and nothing else. It never reads
 * `~/.agentistics`, never talks to tmux, and never imports the session manager: a second process
 * read-modify-writing `managed-sessions.json` beside the running server is the registry race
 * `registry.ts` documents — a record added by a short-lived process has been observed erased by a
 * longer-lived one, leaving a user sitting in a session no verb could name.
 */

import * as vscode from 'vscode'
import { AgentopClient } from './api'
import { resolveEndpoints, type Endpoints } from './config'
import { openDashboard } from './dashboard'
import { resolveLang, strings, type Lang } from './i18n'
import { SessionsHub, SessionsViewProvider, openSessionsPanel } from './sessions'
import { StatusBar } from './status-bar'
import { forgetClosedTerminal, startServerInTerminal } from './terminal'

export function activate(context: vscode.ExtensionContext): void {
  let endpoints: Endpoints = read().endpoints
  let lang: Lang = read().lang
  let words = strings(lang)
  const statusBar = new StatusBar(words)

  function read(): { endpoints: Endpoints; lang: Lang } {
    const config = vscode.workspace.getConfiguration('agentistics')
    return {
      endpoints: resolveEndpoints({
        apiUrl: config.get<string>('apiUrl'),
        dashboardUrl: config.get<string>('dashboardUrl'),
      }),
      lang: resolveLang(config.get<string>('language'), vscode.env.language),
    }
  }

  function setting<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration('agentistics').get<T>(key) ?? fallback
  }

  const hub = new SessionsHub(context, {
    client: () => new AgentopClient(endpoints.api, lang),
    strings: () => words,
    lang: () => lang,
    notifyOnAttention: () => setting('notifyOnAttention', true),
    onAttention: count => statusBar.setAttention(count),
    openDashboard: () => void openDashboard(endpoints.dashboard, 'Agentistics', dashboardNotice()),
  })

  function dashboardNotice(): string {
    return lang === 'pt'
      ? `Não dá para carregar ${endpoints.dashboard} — verifique agentistics.dashboardUrl.`
      : `${endpoints.dashboard} cannot be loaded — check agentistics.dashboardUrl.`
  }

  // A setting that could not be read is REPORTED, not silently replaced: a panel quietly reading a
  // machine the user did not name is worse than a complaint they can act on.
  if (endpoints.invalid) void vscode.window.showWarningMessage(invalidNotice(lang, endpoints.invalid))

  context.subscriptions.push(
    hub,
    statusBar,
    vscode.window.registerWebviewViewProvider(
      SessionsViewProvider.viewType,
      new SessionsViewProvider(hub),
      // The panel keeps its search text and whichever row was open while it is hidden behind
      // another view — losing both on every tab switch is what makes a sidebar unusable.
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.window.onDidCloseTerminal(forgetClosedTerminal),
    vscode.commands.registerCommand('agentistics.openSessions', () => {
      openSessionsPanel(hub, `Agentistics — ${words.title}`)
    }),
    vscode.commands.registerCommand('agentistics.openDashboard', () =>
      openDashboard(endpoints.dashboard, 'Agentistics', dashboardNotice())),
    vscode.commands.registerCommand('agentistics.refresh', () => hub.refresh()),
    vscode.commands.registerCommand('agentistics.startServer', () => startServerInTerminal(words)),
    vscode.commands.registerCommand('agentistics.focusSessions', () =>
      vscode.commands.executeCommand('agentistics.sessions.focus')),
    vscode.commands.registerCommand('agentistics.newSession', async () => {
      await vscode.commands.executeCommand('agentistics.sessions.focus')
      // "Here" is the open workspace folder — the one directory the editor knows and the server
      // cannot guess. With several folders open there is no single "here", so the wizard opens on
      // its own search rather than picking one of them for the user.
      const folders = vscode.workspace.workspaceFolders ?? []
      hub.openWizard(folders.length === 1 ? folders[0]!.uri.fsPath : undefined)
    }),
    vscode.commands.registerCommand('agentistics.attachSession', () => attachViaPicker()),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('agentistics')) return
      const next = read()
      endpoints = next.endpoints
      lang = next.lang
      words = strings(lang)
      statusBar.setStrings(words)
      statusBar.show(setting('statusBar', true))
      restartTodayTimer()
      void hub.refresh()
    }),
  )

  /**
   * The palette route to attaching, for the keyboard-first user who never opens the panel.
   *
   * It asks the SERVER which rows exist and what each one is called rather than composing a list
   * here: the labels, the state words and which rows can be attached to at all are decisions that
   * were already made, in the cockpit's own wording.
   */
  async function attachViaPicker(): Promise<void> {
    const client = new AgentopClient(endpoints.api, lang)
    const { link, payload } = await client.fleet()
    if (link.state !== 'ok' || !payload) {
      void vscode.window.showWarningMessage(words.networkError ?? 'No answer.')
      return
    }
    const attachable = payload.sessions.filter(row => row.actionable)
    if (attachable.length === 0) {
      void vscode.window.showInformationMessage(words.emptyNone ?? 'Nothing to attach to.')
      return
    }
    const picked = await vscode.window.showQuickPick(
      attachable.map(row => ({
        label: row.title,
        description: row.stateLabel,
        detail: `${row.harness} · ${row.cwd}`,
        id: row.id,
      })),
      { placeHolder: words.attach },
    )
    if (!picked) return
    const ticket = await client.attach(picked.id)
    if (!ticket) {
      void vscode.window.showWarningMessage(words.attachUnavailable ?? 'Cannot attach.')
      return
    }
    const { attachInTerminal } = await import('./terminal')
    attachInTerminal(picked.id, ticket, words)
  }

  // ---------------------------------------------------------------------------
  // today's totals — a separate, much slower timer. See status-bar.ts.

  let todayTimer: ReturnType<typeof setInterval> | undefined

  async function readToday(): Promise<void> {
    if (!setting('statusBar', true)) return
    const totals = await new AgentopClient(endpoints.api, lang).today(new Date())
    statusBar.setTotals(totals)
  }

  function restartTodayTimer(): void {
    if (todayTimer) clearInterval(todayTimer)
    const seconds = Math.max(15, setting('statusBarRefreshSeconds', 300))
    void readToday()
    todayTimer = setInterval(() => void readToday(), seconds * 1_000)
  }

  context.subscriptions.push({ dispose: () => { if (todayTimer) clearInterval(todayTimer) } })
  statusBar.show(setting('statusBar', true))
  restartTodayTimer()
}

export function deactivate(): void {
  /* Everything is registered in `context.subscriptions` and disposed by VS Code. */
}

function invalidNotice(lang: Lang, value: string): string {
  return lang === 'pt'
    ? `Agentistics: não consegui ler o endereço “${value}”. Usando o padrão.`
    : `Agentistics: could not read the address “${value}”. Falling back to the default.`
}
