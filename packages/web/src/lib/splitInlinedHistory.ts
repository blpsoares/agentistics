/**
 * Non-Claude harnesses sometimes concatenate a whole conversation into a single user turn
 * (e.g. "User: hi\nAssistant: hello"). This splits such a block into individual bubbles so the
 * transcript renders as a conversation instead of one wall of text.
 *
 * Lives here rather than in SessionDrilldownModal.tsx so its test can import it without dragging
 * React and `lucide-react` into the test module graph — that CJS/ESM interop is what made the
 * suite fail with `react.createContext is not a function`, but only when another file had already
 * loaded React, so it looked like a flake and forced every commit through `--no-verify`.
 */

/** Pattern that matches a newline immediately followed by a conversation label. */
const SPLIT_LABEL_RE = /\n(?=(?:User|Assistant|Gemini|Copilot):)/

export function splitInlinedHistory(
  role: 'user' | 'assistant',
  content: string,
): { role: 'user' | 'assistant'; content: string }[] {
  if (role !== 'user' || !SPLIT_LABEL_RE.test(content)) {
    return [{ role, content }]
  }
  const segments = content.split(SPLIT_LABEL_RE).filter(Boolean)
  const result: { role: 'user' | 'assistant'; content: string }[] = []
  for (const seg of segments) {
    const match = seg.match(/^(User|Assistant|Gemini|Copilot):\s*/)
    if (match) {
      const label = match[1]!
      const text = seg.slice(match[0].length).trim()
      if (!text) continue
      result.push({ role: label === 'User' ? 'user' : 'assistant', content: text })
    } else {
      const text = seg.trim()
      if (text) result.push({ role, content: text })
    }
  }
  return result.length > 0 ? result : [{ role, content }]
}
