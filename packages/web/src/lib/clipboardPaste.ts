/**
 * clipboardPaste.ts — the mobile key strip's `paste` button: read the clipboard, send it as ONE
 * paste. Not pure (it touches `navigator.clipboard`), which is why `keyStrip.ts`'s own
 * `stripEntries` takes availability as a boolean rather than importing this — a PURE module must
 * not reach for `navigator` itself.
 *
 * `navigator.clipboard.readText()` needs a secure context and, on most browsers, a permission grant
 * — exactly the reason the button is offered only when `stripAvailable()` says so, never
 * unconditionally with a button that fails silently for most visitors.
 */

/** Whether THIS browser/context can read the clipboard at all — decides whether `paste` is offered. */
export function clipboardPasteAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function'
}

/**
 * Read the clipboard and hand it to `sendPaste` — an EMPTY clipboard sends nothing (there is
 * nothing to paste), and a denied/failed read is swallowed rather than thrown, the same "the button
 * did nothing rather than crash the page" rule every strip press already follows.
 */
export async function pasteFromClipboard(sendPaste: (text: string) => void): Promise<void> {
  try {
    const text = await navigator.clipboard.readText()
    if (text) sendPaste(text)
  } catch { /* denied, empty, or unsupported at the call site — nothing to send */ }
}
