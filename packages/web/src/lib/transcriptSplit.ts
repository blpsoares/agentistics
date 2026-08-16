/**
 * transcriptSplit.ts — splitInlinedHistory, extracted from SessionDrilldownModal.
 *
 * Non-Claude harnesses sometimes concatenate a whole conversation into a single user turn
 * (e.g. "User: hi\nAssistant: hello"). This splits such a block into individual bubbles so the
 * transcript renders correctly.
 *
 * It lives in lib/ rather than beside the component because it is a pure function with its own
 * unit test: importing it from a .tsx dragged lucide-react's CJS bundle into the test process,
 * which fails to resolve React in a clean environment (green locally, red in CI).
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
