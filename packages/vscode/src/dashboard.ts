/**
 * dashboard.ts — the existing web dashboard, in an editor tab.
 *
 * A frame around `packages/web` and not a second implementation of it. The dashboard is a whole
 * React application — charts, filters, the PDF export, Settings — and every one of those would have
 * to be built twice and then kept in step. Framing it is full parity, permanently, for free.
 *
 * The URL goes through `vscode.env.asExternalUri`, which is what makes this work in a Remote-SSH or
 * Codespaces window: there, `127.0.0.1:47292` in the webview is the LOCAL machine's, not the one
 * the server is running on, and the frame would show whatever happens to be listening at home.
 * `asExternalUri` asks VS Code to forward the port and hands back the address that reaches it.
 */

import * as vscode from 'vscode'
import { dashboardHtml } from './webview/html'

let panel: vscode.WebviewPanel | undefined

export async function openDashboard(url: string, title: string, notice: string): Promise<void> {
  if (panel) {
    panel.reveal()
    return
  }

  panel = vscode.window.createWebviewPanel(
    'agentistics.dashboard',
    title,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      // Kept alive while hidden: the dashboard has filters and a scroll position, and rebuilding
      // the frame on every tab switch would throw both away.
      retainContextWhenHidden: true,
    },
  )

  const external = await resolveExternal(url)
  panel.webview.html = dashboardHtml(
    external,
    { cspSource: panel.webview.cspSource, nonce: '' },
    notice,
  )
  panel.onDidDispose(() => { panel = undefined })
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
