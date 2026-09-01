/**
 * sessions.ts — the fleet, one poll, any number of surfaces.
 *
 * The sidebar view and the editor tab are the SAME document, driven by the SAME poll. Two panels
 * with a timer each would double the traffic and, worse, could show two different fleets a second
 * apart — the panel a user is not looking at is the one that would be right.
 *
 * The hub is also the only thing that acts. A webview posts an intent; the hub calls the server,
 * takes the server's own sentence back, and broadcasts it to every surface — so an action taken in
 * the sidebar reports itself in the editor tab as well.
 */

import * as vscode from 'vscode'
import { AgentopClient } from './api'
import { readAttention, type AttentionMemory } from './attention'
import { fill } from './i18n'
import type { FleetPayload, HostMessage, LinkStatus, ViewMessage } from './protocol'
import { attachInTerminal, startServerInTerminal } from './terminal'
import { sessionsHtml } from './webview/html'

/** The cockpit polls at 5s; matching it keeps the two in step on the same machine. */
const POLL_MS = 5_000

const EMPTY: FleetPayload = { sessions: [], attention: 0, tasks: [] }

export interface HubDeps {
  client(): AgentopClient
  strings(): Record<string, string>
  lang(): 'en' | 'pt'
  notifyOnAttention(): boolean
  onAttention(count: number): void
  openDashboard(): void
}

export class SessionsHub implements vscode.Disposable {
  private readonly surfaces = new Set<vscode.Webview>()
  private timer: ReturnType<typeof setInterval> | undefined
  private memory: AttentionMemory = null
  private link: LinkStatus = { state: 'down', url: '' }
  private fleet: FleetPayload = EMPTY

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly deps: HubDeps,
  ) {}

  /** Wire a webview up: its HTML, its messages, and its share of the current state. */
  register(webview: vscode.Webview): void {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    }
    webview.html = sessionsHtml({
      cspSource: webview.cspSource,
      nonce: nonce(),
      scriptUri: webview.asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'),
      ).toString(),
      styleUri: webview.asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, 'media', 'style.css'),
      ).toString(),
    })
    this.surfaces.add(webview)
    webview.onDidReceiveMessage((msg: ViewMessage) => void this.handle(webview, msg))
    this.start()
  }

  unregister(webview: vscode.Webview): void {
    this.surfaces.delete(webview)
    if (this.surfaces.size === 0) this.stop()
  }

  /**
   * Poll only while something is looking.
   *
   * A background timer running with every panel closed would keep capturing each live session's
   * screen for a window nobody has open — the cheapest possible way to spend someone's battery.
   */
  private start(): void {
    if (this.timer) return
    void this.poll()
    this.timer = setInterval(() => void this.poll(), POLL_MS)
  }

  private stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = undefined
  }

  async refresh(): Promise<void> {
    await this.poll()
  }

  /** Open the wizard on every surface, pointed where the caller says. */
  openWizard(cwd?: string): void {
    this.broadcast({ type: 'openWizard', ...(cwd ? { cwd } : {}) })
  }

  private async poll(): Promise<void> {
    const { link, payload } = await this.deps.client().fleet()
    this.link = link
    // A failed poll keeps the PREVIOUS fleet, exactly as the cockpit's poller does: the last known
    // truth beats a confident empty list, and the banner above it already says the link is down.
    if (payload) this.fleet = payload

    const update = readAttention(this.memory, this.fleet.sessions)
    this.memory = update.memory
    this.deps.onAttention(update.count)
    if (this.deps.notifyOnAttention()) {
      for (const row of update.announce) this.announce(row.id, row.title)
    }
    this.broadcast({
      type: 'state',
      link: this.link,
      fleet: this.fleet,
      strings: this.deps.strings(),
      lang: this.deps.lang(),
    })
  }

  /** One toast per transition, with a way straight to the row it is about. */
  private announce(id: string, title: string): void {
    const strings = this.deps.strings()
    void vscode.window
      .showWarningMessage(fill(strings.attentionToast ?? '{0}', title), strings.attentionOpen ?? 'Open')
      .then(picked => {
        if (!picked) return
        void vscode.commands.executeCommand('agentistics.focusSessions')
      })
  }

  private broadcast(msg: HostMessage): void {
    for (const surface of this.surfaces) void surface.postMessage(msg)
  }

  private async handle(webview: vscode.Webview, msg: ViewMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        void webview.postMessage({
          type: 'state',
          link: this.link,
          fleet: this.fleet,
          strings: this.deps.strings(),
          lang: this.deps.lang(),
        } satisfies HostMessage)
        return
      case 'refresh':
        await this.poll()
        return
      case 'act': {
        const out = await this.deps.client().act(msg)
        this.broadcast({ type: 'result', ok: out.ok, message: out.message })
        // Re-read straight away rather than waiting up to five seconds: the user just did
        // something and the list is the only evidence it happened.
        await this.poll()
        return
      }
      case 'attach': {
        const ticket = await this.deps.client().attach(msg.id)
        const strings = this.deps.strings()
        if (!ticket) {
          this.broadcast({
            type: 'result',
            ok: false,
            message: strings.attachUnavailable ?? 'This session cannot be attached from here.',
          })
          return
        }
        attachInTerminal(msg.id, ticket, strings)
        return
      }
      case 'copy':
        await vscode.env.clipboard.writeText(msg.text)
        this.broadcast({ type: 'result', ok: true, message: this.deps.strings().copied ?? 'Copied.' })
        return
      case 'openFolder':
        // A new window, always: replacing the current one would close the panel the user is
        // standing in, along with whatever else they had open.
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(msg.path), {
          forceNewWindow: true,
        })
        return
      case 'newOptions': {
        const options = await this.deps.client().newOptions(msg.query)
        void webview.postMessage({ type: 'newOptions', options } satisfies HostMessage)
        return
      }
      case 'spawn': {
        const out = await this.deps.client().spawn(msg.request)
        this.broadcast({ type: 'result', ok: out.ok, message: out.message })
        await this.poll()
        // Attach only to the session that was actually started, by the id the spawn returned —
        // never by looking for "the newest row in that directory", which on a machine already
        // running three sessions there is a guess.
        if (out.ok && msg.attach && out.id) {
          const ticket = await this.deps.client().attach(out.id)
          if (ticket) attachInTerminal(out.id, ticket, this.deps.strings())
        }
        return
      }
      case 'openDashboard':
        this.deps.openDashboard()
        return
      case 'startServer':
        startServerInTerminal(this.deps.strings())
        return
    }
  }

  dispose(): void {
    this.stop()
    this.surfaces.clear()
  }
}

/** The docked view. Compact by circumstance, identical in content to the tab. */
export class SessionsViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'agentistics.sessions'

  constructor(private readonly hub: SessionsHub) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.hub.register(view.webview)
    view.onDidDispose(() => this.hub.unregister(view.webview))
  }
}

/** The same document, in an editor tab, for when the sidebar is too narrow to work in. */
export function openSessionsPanel(hub: SessionsHub, title: string): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    'agentistics.sessionsPanel',
    title,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  )
  hub.register(panel.webview)
  panel.onDidDispose(() => hub.unregister(panel.webview))
  return panel
}

/**
 * A fresh value per document.
 *
 * `Math.random` is not a cryptographic source and does not need to be: the nonce keeps a stray
 * injected `<script>` from running in a document whose contents this extension wrote, not an
 * attacker who can already read the page from guessing it.
 */
function nonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < 32; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}
