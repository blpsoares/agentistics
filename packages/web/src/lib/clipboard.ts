/**
 * Robust clipboard copy. The async Clipboard API only works in a secure context
 * (HTTPS or localhost) and when the document is focused — so it silently fails when
 * the dashboard is served over plain HTTP via a LAN/Tailscale IP. Fall back to a
 * hidden <textarea> + execCommand('copy'), which works in insecure contexts too.
 *
 * Returns true on success, false if every strategy failed.
 */
export async function copyText(text: string): Promise<boolean> {
  // 1. Async Clipboard API (best, but needs a secure context + focus).
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through to the legacy path */ }

  // 2. Legacy execCommand fallback — works over plain HTTP.
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-9999px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    if (ok) return true
  } catch { /* nothing worked */ }

  return false
}
