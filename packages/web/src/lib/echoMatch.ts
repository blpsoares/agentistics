/**
 * echoMatch.ts — PURE: which delivered messages the transcript has taken in.
 *
 * An echo is a message already handed to the session, shown in the conversation until the
 * transcript carries it. Retiring it was an EQUALITY test over collapsed whitespace, and equality
 * is the wrong relation — measured on the transcript of the session that reported this:
 *
 *     '> /home/…/9f6434bc-image.png\n> era mais ou menos algo assim…\n'
 *     'pode fazer tudo. so quanto aquela imagem vc n me respondeu\r\n'
 *     '\n[Image #22] esse prompt ta pendurado tem uma eternidade…'
 *
 * ONE user entry, holding TWO messages. A harness that is mid-turn QUEUES what arrives and commits
 * the queue as a single turn, so the second message is stored joined to the first — and the
 * terminal put `\r` in it on the way. The echo is therefore a SUBSTRING of what was stored and can
 * never equal it, so the label stood there forever under a message that had arrived and been
 * answered. "ainda tem mensagem que ta ficando eternamente na fila."
 *
 * So containment, not equality — with one guard. A very short echo ("ok", "sim") appears inside
 * unrelated turns by coincidence, and retiring it there would hide a message that really was still
 * waiting. Below `SAFE_CONTAINS_LEN` the old equality rule stands: a false "still waiting" on a
 * two-letter message costs a glance, a false "delivered" costs the message.
 *
 * THE SECOND SHAPE, AND IT LOOKED LIKE A DUPLICATE MESSAGE. A message with attachments is sent as
 * one path per line followed by the prose — that is what the composer types into the pane — and the
 * harness stores it with the paths REPLACED by its own markers. Measured on this machine:
 *
 *   echo    '/home/u/.agentistics/attachments/ab-image.png\n…/cd-image.png\nvou te passar…'
 *   stored  '[Image #26] [Image #27]vou te passar…'
 *
 * Neither equal nor contained, so the echo stood forever BESIDE the transcript's own copy of the
 * same message — two bubbles, one message. Reported as exactly that: "aparentemente o prompt que eu
 * mandei por aqui tbm foi enviado via terminal e dai duplicou". Nothing was sent twice.
 *
 * So an echo is also compared by its PROSE — itself minus the attachment lines it added. And when
 * there is no prose (a message that was only files), by the COUNT: a stored turn that is nothing
 * but markers, as many as the echo carried paths. That second rule is narrow on purpose — it never
 * fires on a turn that has words in it.
 */

/** Whitespace is collapsed on both sides: the harness re-wraps what it stores, and adds `\r`. */
export function collapseEcho(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Shorter than this and only an exact match retires the echo.
 *
 * Long enough that a coincidence is not credible, short enough to cover a real one-line message
 * ("faz o merge e sobe o binário" is 28).
 */
export const SAFE_CONTAINS_LEN = 12

/** The echoes that are still waiting, given what the transcript's user turns now say. */
/** A line that is nothing but a path — what the composer adds for each attachment. */
function isPathLine(line: string): boolean {
  const t = line.trim()
  return t !== '' && !/\s/.test(t) && (t.startsWith('/') || /^[A-Za-z]:[\\/]/.test(t))
}

/** The echo without the attachment lines it carries, and how many those were. */
export function echoProse(text: string): { prose: string; paths: number } {
  const lines = text.split('\n')
  const kept = lines.filter(l => !isPathLine(l))
  return { prose: collapseEcho(kept.join('\n')), paths: lines.length - kept.length }
}

const MARKER = /\[Image #\d+\]/g

/** How many markers a stored turn is made of, when it is made of nothing else. */
function markerOnlyCount(turn: string): number {
  const t = turn.trim()
  const markers = t.match(MARKER)
  if (!markers) return 0
  return t.replace(MARKER, '').trim() === '' ? markers.length : 0
}

/**
 * A stored turn with its LEADING markers removed — what is left is the prose the person typed.
 *
 * Only leading ones, and only for comparison: the harness puts them where the composer put the
 * paths, which is the top. A marker in the middle of a sentence is something the person wrote.
 */
function withoutLeadingMarkers(turn: string): string {
  return collapseEcho(turn.trim().replace(/^(?:\[Image #\d+\]\s*)+/, ''))
}

export function pendingEchoes(
  echoes: readonly string[],
  userTurns: readonly string[],
): string[] {
  const seen = userTurns.map(collapseEcho).filter(t => t !== '')
  const landed = (c: string): boolean =>
    seen.includes(c) || (c.length >= SAFE_CONTAINS_LEN && seen.some(t => t.includes(c)))
  return echoes.filter(text => {
    const c = collapseEcho(text)
    if (c === '') return false
    if (landed(c)) return false
    const { prose, paths } = echoProse(text)
    if (paths === 0) return true
    // The prose against the stored turn with its leading markers removed. EXACT equality is enough
    // here and is what makes it safe for a two-word message: the markers stand exactly where the
    // paths stood, so what remains on both sides is the same typed sentence — no coincidence to
    // guard against, and none of the length rule's caution is needed.
    const stripped = userTurns.map(withoutLeadingMarkers).filter(t => t !== '')
    if (prose !== '' && (stripped.includes(prose)
      || (prose.length >= SAFE_CONTAINS_LEN && stripped.some(t => t.includes(prose))))) return false
    // Only files and no words: match a turn that is only markers, as many as there were paths.
    if (prose === '' && userTurns.some(t => markerOnlyCount(t) === paths)) return false
    return true
  })
}
