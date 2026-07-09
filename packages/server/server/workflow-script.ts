/** Best-effort parse of a saved workflow script (JS text) for display metadata.
 *  Not an evaluator — pure string scanning over the literal `meta` block and agent() calls. */
export function parseWorkflowScript(script: string): {
  name: string
  phases: string[]
  agents: { label: string; phase: string; model: string }[]
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
  const agents: { label: string; phase: string; model: string }[] = []
  const callStarts: number[] = []
  const callRe = /\bagent\s*\(/g
  let c: RegExpExecArray | null
  while ((c = callRe.exec(script)) !== null) callStarts.push(c.index)
  for (let i = 0; i < callStarts.length; i++) {
    const start = callStarts[i]!
    const end = i + 1 < callStarts.length ? callStarts[i + 1]! : script.length
    const chunk = script.slice(start, end)
    const pick = (k: string) => chunk.match(new RegExp('\\b' + k + "\\s*:\\s*['\"`]([^'\"`]+)['\"`]"))?.[1] ?? ''
    agents.push({ label: pick('label'), phase: pick('phase'), model: pick('model') })
  }

  return { name, phases, agents }
}
