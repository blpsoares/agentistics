/**
 * html.ts — PURE. The two documents this extension serves into a webview.
 *
 * A webview is a browser, so both carry a real Content-Security-Policy: `default-src 'none'` and
 * then exactly what each page needs. The script is admitted by NONCE rather than by origin — a
 * webview's asset origin is shared with every other extension's webview, so an origin allowance is
 * not the guarantee it looks like.
 *
 * Everything interpolated is escaped, including values that "come from settings and are therefore
 * ours". `agentistics.dashboardUrl` is a string a workspace can set, and a workspace is not
 * necessarily the user's own — a `"` in the wrong place turns an attribute into markup, which is
 * the whole of that class of bug.
 */

export interface Shell {
  /** `webview.cspSource` — the origin the extension's own assets are served from. */
  cspSource: string
  /** A fresh value per document. Never reused across renders. */
  nonce: string
  scriptUri: string
  styleUri: string
}

/** Attribute-safe. The five characters that can leave an attribute or open a tag. */
export function escapeAttr(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Text-safe, for a sentence written into the body. */
export function escapeText(raw: string): string {
  return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * The ORIGIN a frame may be loaded from, for the CSP — never the full URL.
 *
 * A CSP source with a path in it is not the narrowing it appears to be, and an unparseable setting
 * yields `null`, which the caller turns into a page that says so. Inventing `*` there would open
 * the frame to anything the day someone typos a port.
 */
export function frameOrigin(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.origin
  } catch {
    return null
  }
}

/** The Sessions panel — the same document whether it is docked in the sidebar or an editor tab. */
export function sessionsHtml(shell: Shell): string {
  const csp = [
    "default-src 'none'",
    `img-src ${shell.cspSource} data:`,
    `style-src ${shell.cspSource}`,
    `font-src ${shell.cspSource}`,
    `script-src 'nonce-${shell.nonce}'`,
  ].join('; ')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeAttr(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${escapeAttr(shell.styleUri)}">
<title>Agentistics Sessions</title>
</head>
<body>
<div id="root"></div>
<script nonce="${escapeAttr(shell.nonce)}" src="${escapeAttr(shell.scriptUri)}"></script>
</body>
</html>`
}

/**
 * The Dashboard panel — the existing web dashboard, in a frame.
 *
 * A frame and not a reimplementation: the dashboard is a whole React application with charts,
 * filters, a PDF export and a settings screen, and every one of those would have to be built twice
 * and then kept in step. What this document adds is the frame, the CSP that admits exactly one
 * origin, and — when that origin cannot be worked out — a sentence instead of a blank rectangle.
 */
export interface DashboardStrings {
  /** Shown instead of the frame when the address cannot be parsed at all. */
  notice: string
  /** The line above the frame: what is being shown, and where to go if it is blank. */
  bar: string
  openExternal: string
}

export function dashboardHtml(
  url: string,
  shell: Pick<Shell, 'cspSource' | 'nonce'>,
  strings: DashboardStrings,
): string {
  const origin = frameOrigin(url)
  const nonce = shell.nonce || 'dashboard'
  const csp = [
    "default-src 'none'",
    `style-src ${shell.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    origin ? `frame-src ${origin}` : "frame-src 'none'",
  ].join('; ')

  // The bar is ALWAYS drawn, not only on failure. A frame that a policy refuses does not report
  // itself to the page — there is no event for "the browser declined to load this" — so a tab that
  // only showed a fallback after detecting one would show nothing, forever, in exactly the case
  // that needs explaining. One line saying what is being framed and offering the browser costs a
  // row and removes the mystery.
  const body = origin
    ? `<div class="bar">
  <span class="addr">${escapeText(strings.bar)} <code>${escapeText(url)}</code></span>
  <button id="external" type="button">${escapeText(strings.openExternal)}</button>
</div>
<iframe src="${escapeAttr(url)}" title="Agentistics"></iframe>`
    : `<p class="notice">${escapeText(strings.notice)}</p>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeAttr(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { height: 100%; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .bar {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 4px 8px; font-family: var(--vscode-font-family); font-size: 12px;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-editorWidget-background);
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .bar .addr { flex: 1; overflow-wrap: anywhere; }
  .bar button {
    font: inherit; cursor: pointer; padding: 2px 8px; border-radius: 4px;
    border: 1px solid var(--vscode-contrastBorder, transparent);
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  iframe { border: 0; width: 100%; flex: 1; display: block; }
  .notice { padding: 16px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
</style>
<title>Agentistics</title>
</head>
<body>${body}
<script nonce="${escapeAttr(nonce)}">
  const vscode = acquireVsCodeApi();
  document.getElementById('external')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openExternal' });
  });
</script>
</body>
</html>`
}
