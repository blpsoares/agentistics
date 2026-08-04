/** Best-effort parse of a saved workflow script (JS text) for display metadata.
 *  Not an evaluator — pure string scanning over the literal `meta` block and agent() calls. */
export function parseWorkflowScript(script: string): {
  name: string
  phases: string[]
  agents: { label: string; phase: string; model: string; fingerprints: string[] }[]
} {
  if (!script) return { name: '', phases: [], agents: [] }

  const nameMatch = script.match(/name\s*:\s*['"`]([^'"`]+)['"`]/)
  const name = nameMatch?.[1] ?? ''

  // phases: [{ title: '...' }, ...] — grab the phases array text, then each title.
  const phases: string[] = []
  const phasesBlock = script.match(/phases\s*:\s*\[([\s\S]*?)\]/)
  if (phasesBlock) {
    const re = /title\s*:\s*['"`]([^'"`]+)['"`]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(phasesBlock[1]!)) !== null) phases.push(m[1]!)
  }

  // Split the script into chunks, one per agent() call: from each `agent(`
  // occurrence to just before the next. We read label/phase/model string
  // literals from within the chunk instead of brace-matching the options
  // object — tolerant of prompts that contain code snippets or template
  // literals with stray { } }) characters. One entry per call keeps the list
  // index-aligned with the actual agent invocations.
  const agents: { label: string; phase: string; model: string; fingerprints: string[] }[] = []
  const callStarts: { index: number; argAt: number }[] = []
  const callRe = /\bagent\s*\(\s*/g
  let c: RegExpExecArray | null
  while ((c = callRe.exec(script)) !== null) callStarts.push({ index: c.index, argAt: c.index + c[0]!.length })
  for (let i = 0; i < callStarts.length; i++) {
    const start = callStarts[i]!
    const end = i + 1 < callStarts.length ? callStarts[i + 1]!.index : script.length
    const chunk = script.slice(start.index, end)
    const pick = (k: string) => chunk.match(new RegExp('\\b' + k + "\\s*:\\s*['\"`]([^'\"`]+)['\"`]"))?.[1] ?? ''
    agents.push({
      label: pick('label'), phase: pick('phase'), model: pick('model'),
      fingerprints: promptFingerprints(script, start.argAt),
    })
  }

  return { name, phases, agents }
}

/** A fingerprint shorter than this identifies nothing — "ok", "Leia" and a bare newline appear in
 *  every prompt of a script, and matching on one would attribute a transcript to the wrong call. */
const MIN_FINGERPRINT = 32
/** Enough to survive a script edit that rewrites one paragraph; more only costs comparison time. */
const MAX_FINGERPRINTS = 3

/** The literal (non-interpolated) segments of the prompt argument starting at `at`, longest first.
 *  Empty when the argument is not a string/template literal, or is entirely `${…}`. */
export function promptFingerprints(script: string, at: number): string[] {
  const quote = script[at]
  if (quote !== '`' && quote !== "'" && quote !== '"') return []

  const parts: string[] = []
  let buf = ''
  let i = at + 1
  while (i < script.length) {
    const ch = script[i]!
    if (ch === '\\') { buf += unescape(script[i + 1] ?? ''); i += 2; continue }
    if (ch === quote) break
    // A template hole is a gap in the literal text: close the current segment and skip the
    // expression, counting braces so a nested template (`${xs.map(x => `- ${x}`)}`) is skipped whole.
    if (quote === '`' && ch === '$' && script[i + 1] === '{') {
      parts.push(buf); buf = ''
      let depth = 1
      i += 2
      while (i < script.length && depth > 0) {
        if (script[i] === '{') depth++
        else if (script[i] === '}') depth--
        i++
      }
      continue
    }
    buf += ch
    i++
  }
  parts.push(buf)

  return parts
    .map(p => p.trim())
    .filter(p => p.length >= MIN_FINGERPRINT)
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_FINGERPRINTS)
}

function unescape(ch: string): string {
  switch (ch) {
    case 'n': return '\n'
    case 't': return '\t'
    case 'r': return '\r'
    default: return ch  // \\ \` \$ \' \" — the character itself
  }
}
