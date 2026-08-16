/** PURE: which declared `agent()` call produced which transcript.
 *
 *  A run's transcripts are named `agent-<hash>.jsonl` — the hash carries no order, so pairing
 *  them with the script's `agent()` calls BY POSITION (after an alphabetical file sort) attributes
 *  every metric to an arbitrary agent. It is not "approximately right": the labels and the numbers
 *  come from different agents entirely, and the run still renders as if it were correct.
 *
 *  The one thing a transcript and its call provably share is the PROMPT. A call's prompt is a
 *  template with `${...}` holes; the transcript holds the resolved text. So a call is identified by
 *  its longest LITERAL prompt segments (its fingerprints) appearing verbatim in the transcript.
 *
 *  It is deliberately conservative: a transcript that matches nothing, or that ties between two
 *  calls, is reported as UNKNOWN. A wrong label is worse than a missing one — that is the bug
 *  this module exists to end. A call may legitimately claim MANY transcripts (a loop or a
 *  `pipeline()` re-runs the same call site), so matching is per transcript, never a bijection. */
export interface WorkflowCall {
  label: string
  phase: string
  model: string
  /** Literal prompt segments, longest first. Empty when the prompt is fully dynamic. */
  fingerprints: string[]
}

/** Score = length of the longest fingerprint of `call` found in `prompt`; 0 when none is. */
function score(prompt: string, call: WorkflowCall): number {
  let best = 0
  for (const fp of call.fingerprints) {
    if (fp.length > best && prompt.includes(fp)) best = fp.length
  }
  return best
}

/** For each transcript, the call that produced it — or `undefined` when it cannot be told. */
export function matchTranscriptsToCalls(
  transcripts: { prompt: string }[],
  calls: WorkflowCall[],
): (WorkflowCall | undefined)[] {
  return transcripts.map(t => {
    let best: WorkflowCall | undefined
    let bestScore = 0
    let tied = false
    for (const call of calls) {
      const s = score(t.prompt, call)
      if (s === 0) continue
      if (s > bestScore) { best = call; bestScore = s; tied = false }
      else if (s === bestScore) tied = true
    }
    return tied ? undefined : best
  })
}
