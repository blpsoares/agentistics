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

  // agent(<prompt>, { ...opts }) — scan each opts object for label/phase/model literals.
  const agents: { label: string; phase: string; model: string }[] = []
  const agentRe = /agent\s*\([\s\S]*?\{([\s\S]*?)\}\s*\)/g
  let a: RegExpExecArray | null
  while ((a = agentRe.exec(script)) !== null) {
    const opts = a[1]!
    const pick = (k: string) => opts.match(new RegExp(k + "\\s*:\\s*['\"`]([^'\"`]+)['\"`]"))?.[1] ?? ''
    const label = pick('label')
    const phase = pick('phase')
    const model = pick('model')
    if (label || phase || model) agents.push({ label, phase, model })
  }

  return { name, phases, agents }
}
