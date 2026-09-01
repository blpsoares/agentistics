/**
 * dashboard.ts — the existing web dashboard, in an editor tab.
 *
 * A frame around `packages/web` and not a second implementation of it. The dashboard is a whole
 * React application — charts, filters, the PDF export, Settings — and every one of those would have
 * to be built twice and then kept in step. Framing it is full parity, permanently, for free.
 *
 * Reaching it from inside a webview takes two things, and BOTH are needed in a Remote-SSH or WSL
 * window:
 *
 * 1. **`portMapping`.** A webview is a browser context on the CLIENT machine. `127.0.0.1:47292`
 *    inside it means the client's own port, which in a remote window is not the machine the server
 *    runs on — it is whatever happens to be listening on the laptop. `portMapping` tells VS Code to
 *    route that port through to the extension host, which is where the server is.
 * 2. **`asExternalUri`**, for the deployments where the address is genuinely somewhere else.
 *
 * And when the frame still cannot load — an exposure profile that refuses to be framed, a proxy, an
 * address the user typed wrong — the tab must not be a blank rectangle. It carries a bar with the
 * address it is trying and a button that opens it in a real browser, so the answer is one click
 * away instead of a mystery.
 */

import * as vscode from 'vscode'
import { dashboardHtml } from './webview/html'

let panel: vscode.WebviewPanel | undefined

export interface DashboardText {
  /** Title of the tab. */
  title: string
  /** The sentence shown when the address cannot be parsed at all. */
  notice: string
  /** Label for the button that opens it outside the editor. */
  openExternal: string
  /** The one line above the frame: what is being shown, and where to go if it is blank. */
  bar: string
}

export async function openDashboard(url: string, text: DashboardText): Promise<void> {
  if (panel) {
    panel.reveal()
    return
  }

  const port = portOf(url)
  panel = vscode.window.createWebviewPanel(
    'agentistics.dashboard',
    text.title,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      // Kept alive while hidden: the dashboard has filters and a scroll position, and rebuilding
      // the frame on every tab switch would throw both away.
      retainContextWhenHidden: true,
      // See the header. Harmless when the window is local — the mapping is then an identity.
      ...(port ? { portMapping: [{ webviewPort: port, extensionHostPort: port }] } : {}),
    },
  )

  const external = await resolveExternal(url)
  panel.webview.html = dashboardHtml(
    external,
    { cspSource: panel.webview.cspSource, nonce: '' },
    { notice: text.notice, bar: text.bar, openExternal: text.openExternal },
  )
  panel.webview.onDidReceiveMessage((msg: { type?: string }) => {
    // The one message this document sends: "the frame is not showing me anything, take me there".
    if (msg?.type === 'openExternal') void vscode.env.openExternal(vscode.Uri.parse(url))
  })
  panel.onDidDispose(() => { panel = undefined })
}

function portOf(url: string): number | null {
  try {
    const port = Number(new URL(url).port)
    return Number.isInteger(port) && port > 0 ? port : null
  } catch {
    return null
  }
}

/**
 * The address that reaches the server FROM THIS WINDOW.
 *
 * Falls back to the address as configured when VS Code cannot forward it — a local window needs no
 * forwarding at all, and a failure here must not leave the tab blank when the plain URL would have
 * worked perfectly.
 */
async function resolveExternal(url: string): Promise<string> {
  try {
    const external = await vscode.env.asExternalUri(vscode.Uri.parse(url))
    return external.toString()
  } catch {
    return url
  }
}
