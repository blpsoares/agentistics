/**
 * artifactTabs.ts — PURE: what the artifacts panel's three tabs contain.
 *
 * FILES is everything the session wrote that is still a readable file with content — the server
 * decides that, because only it can look at the disk.
 *
 * DOCS is the subset somebody would READ rather than run: specs, plans, notes, READMEs. It is a
 * subset and never a separate list, so a document cannot be in one tab and missing from the other.
 * The rule is the EXTENSION plus a small set of names, because that is what can be decided without
 * opening the file — guessing at "is this a spec" from a path's words would file
 * `packages/server/spec-runner.ts` under documentation.
 *
 * LIVE is the activity, in order: what the session read, wrote, ran, thought and delegated. It is
 * built from the same turns the conversation renders, so it can never claim something the
 * transcript does not show. Each entry says WHICH KIND it is, because "read a file" and "ran a
 * command" are different events and a single grey list of strings is a log, not a view.
 */

/** Extensions whose files are read rather than executed. */
const DOC_EXT = new Set(['md', 'mdx', 'txt', 'rst', 'adoc'])

/** Names that are documentation whatever their extension. */
const DOC_NAME = new Set(['README', 'CHANGELOG', 'LICENSE', 'AGENTS', 'CLAUDE', 'NOTES', 'TODO'])

/** Is this path a document — something written to be read? */
export function isDoc(path: string): boolean {
  const name = path.split('/').pop() ?? path
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  if (DOC_EXT.has(ext)) return true
  // A KNOWN NAME counts only when it carries no extension of its own. `src/readme.tsx` is a React
  // component whose file happens to be called readme, and filing it under documentation is the
  // same guess-from-the-path this rule exists to refuse.
  if (dot > 0) return false
  return DOC_NAME.has(name.toUpperCase())
}

/** One thing the session did, in the order it did it. */
export interface LiveEvent {
  kind: 'wrote' | 'read' | 'ran' | 'thought' | 'delegated' | 'said'
  /** When the turn that produced it was recorded, ISO — absent on a transcript that carries none. */
  at?: string
  /** The path, the command, or the first line of what was said — already trimmed for a row. */
  text: string
  /** True while the turn that produced it has not finished. */
  live: boolean
}

export interface LiveTurn {
  at?: string
  role?: string
  text?: string
  thinking?: string
  pending?: boolean
  tools?: { name: string; detail?: string; writes?: string[] }[]
}

/** Tools that READ rather than change anything. */
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'NotebookRead', 'WebFetch', 'WebSearch'])
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

/** One line of a longer text, for a row that has one line to give. */
function firstLine(s: string, max = 160): string {
  const line = s.trim().split('\n').find(l => l.trim() !== '')?.trim() ?? ''
  return line.length > max ? `${line.slice(0, max)}…` : line
}

/**
 * The activity feed, newest LAST — the transcript's own order, which is what makes it readable as
 * a sequence rather than a set.
 *
 * An assistant's prose is included as `said` because the panel is meant to answer "what is
 * happening", and a turn that only explains what it is about to do is part of that. The USER's own
 * messages are not: this is the session's activity, and the person already has their own words.
 */
export function liveEvents(turns: readonly LiveTurn[]): LiveEvent[] {
  const out: LiveEvent[] = []
  for (const t of turns) {
    const live = t?.pending === true
    const at = t?.at
    const ev = (kind: LiveEvent['kind'], text: string): LiveEvent =>
      at ? { kind, text, live, at } : { kind, text, live }
    if (t?.thinking) out.push(ev('thought', firstLine(t.thinking)))
    for (const c of t?.tools ?? []) {
      // A command that writes is BOTH events, in the order they happen: it ran, and then the file
      // appeared. Collapsing them would lose either what was run or what it produced, and the feed
      // is asked for both.
      if (c.name === 'Bash' && c.detail) out.push(ev('ran', c.detail))
      for (const w of c.writes ?? []) out.push(ev('wrote', w))
      if (WRITE_TOOLS.has(c.name) && c.detail) out.push(ev('wrote', c.detail))
      else if (READ_TOOLS.has(c.name) && c.detail) out.push(ev('read', c.detail))
      // A subagent is a delegation, not a command — it is the one tool call that starts more work
      // somewhere else, and reading it as "ran" hides that.
      else if (c.name === 'Agent' || c.name === 'Task') out.push(ev('delegated', c.detail ?? c.name))
    }
    if (t?.role === 'assistant' && t.text && t.text.trim() !== '') {
      out.push(ev('said', firstLine(t.text)))
    }
  }
  return out
}

/**
 * "How long ago", in the shortest form that is still true.
 *
 * Relative rather than a clock time because the question the feed answers is "is this happening
 * NOW or did it happen a while back", and `14:32` makes the reader do that subtraction themselves.
 * An absent timestamp yields an empty string: nothing is invented, and the row simply carries no
 * time — the same rule the gauge follows when it cannot know a context window.
 */
export function agoLabel(at: string | undefined, now: number, pt: boolean): string {
  if (!at) return ''
  const t = Date.parse(at)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 10) return pt ? 'agora' : 'now'
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.round(h / 24)}d`
}
