/**
 * WHERE a search matched — the difference between a list of rows and an answer.
 *
 * The search used to be one lowercased blob per row (`SessionView.searchText`) tested with
 * `.includes()`. That finds the row and then refuses to say why: typing `docker` returned a
 * session whose folder, harness, note and opening prompt were all invisible to the reader, so the
 * only way to learn which of them carried the word was to open the session and look. Worse, the
 * blob is composed differently for the three kinds of row, so the same query searched a different
 * set of things depending on whether a conversation happened to be running.
 *
 * Named fields make the scope a FACT the screen can print, which is what lets the header say how
 * deep the match went and each row say which field earned its place.
 */

/** The searchable dimensions of a session row, in the order a reader scans them. */
export const SEARCH_SCOPES = ['name', 'folder', 'harness', 'note', 'task', 'prompt', 'transcript'] as const

export type SearchScope = typeof SEARCH_SCOPES[number]

/**
 * The text of every scope a row carries ON ITS OWN.
 *
 * `transcript` is deliberately absent: it is not a property of the row but the answer to a
 * question asked of the disk, and putting it here would mean holding conversation text in the
 * view — the exact shape that leaked whole transcripts to a central once already. It reaches
 * `matchScopes` as a boolean the caller resolved.
 */
export interface SearchFields {
  /** What the row is CALLED — the user's label, or the title the harness gave it. */
  name: string
  /** The working directory. */
  folder: string
  harness: string
  /** The user's own note on this row. */
  note: string
  /** The task this row belongs to. */
  task: string
  /** The conversation's opening prompt — what a person remembers about something they closed. */
  prompt: string
}

/** Scopes other than `transcript`, which no row can answer by itself. */
const OWN_SCOPES = SEARCH_SCOPES.filter((s): s is Exclude<SearchScope, 'transcript'> => s !== 'transcript')

export function emptySearchFields(): SearchFields {
  return { name: '', folder: '', harness: '', note: '', task: '', prompt: '' }
}

/**
 * The scopes of one row that carry `query`, in `SEARCH_SCOPES` order.
 *
 * An empty query matches NOTHING rather than everything: the caller decides that an unfiltered
 * list is unfiltered, and a wildcard here would report every row as matching every scope.
 */
export function matchScopes(
  fields: SearchFields,
  query: string,
  found: { transcript?: boolean } = {},
): SearchScope[] {
  const q = query.trim().toLowerCase()
  if (q === '') return []

  const hit: SearchScope[] = []
  for (const scope of OWN_SCOPES) {
    if (fields[scope].toLowerCase().includes(q)) hit.push(scope)
  }
  if (found.transcript) hit.push('transcript')
  return hit
}

/** Whether a row matches at all — the predicate the list filters on. */
export function matchesQuery(
  fields: SearchFields,
  query: string,
  found: { transcript?: boolean } = {},
): boolean {
  return query.trim() === '' || matchScopes(fields, query, found).length > 0
}

/** The words the depth line needs, supplied by the caller — this module holds no strings. */
export interface SearchScopeWords {
  scope: Record<SearchScope, string>
  noGrep: string
  noTranscripts: string
}

/** What the transcript half of the search is currently doing. */
export interface TranscriptState {
  running?: boolean
  runningWord?: string
  unavailable?: 'no-grep' | 'no-transcripts'
}

/**
 * HOW DEEP the search went, as one line: `name 3 · prompt 5 · transcript 47`.
 *
 * A scope nothing matched is left OUT, because printing seven scopes on every keystroke buries
 * the two that answered the question — EXCEPT `transcript`, which is always stated. That
 * asymmetry is the point: the other six are read from data already in memory and always ran, so
 * their silence means zero. The transcript is read off the disk and might not have run at all, so
 * an absent line would be indistinguishable from "nothing said this" — and the reader would draw
 * the wrong conclusion and stop looking. Same rule as `liveEmptyNotice`, in one line of chrome.
 */
export function searchDepthText(
  counts: ScopeCounts,
  words: SearchScopeWords,
  state: TranscriptState,
): string {
  const parts: string[] = []
  for (const scope of OWN_SCOPES) {
    if (counts[scope] > 0) parts.push(`${words.scope[scope]} ${counts[scope]}`)
  }

  if (state.unavailable) {
    parts.push(state.unavailable === 'no-grep' ? words.noGrep : words.noTranscripts)
  } else if (state.running) {
    // Not `transcript 0`: the count is simply not in yet, and a zero that turns into 47 a moment
    // later teaches the reader that the number cannot be trusted.
    parts.push(state.runningWord ?? '…')
  } else {
    parts.push(`${words.scope.transcript} ${counts.transcript}`)
  }

  return parts.join(' · ')
}

export type ScopeCounts = Record<SearchScope, number>

export function emptyScopeCounts(): ScopeCounts {
  return { name: 0, folder: 0, harness: 0, note: 0, task: 0, prompt: 0, transcript: 0 }
}

/**
 * How many rows carry the query in each scope — the header's "how deep did this go" line.
 *
 * Every scope is present even at zero: a scope missing from the record and a scope nobody matched
 * read identically to a caller, and the second is a real answer while the first is not.
 */
export function scopeCounts(
  rows: readonly { fields: SearchFields; transcript?: boolean }[],
  query: string,
): ScopeCounts {
  const counts = emptyScopeCounts()
  if (query.trim() === '') return counts
  for (const row of rows) {
    for (const scope of matchScopes(row.fields, query, { transcript: row.transcript })) {
      counts[scope]++
    }
  }
  return counts
}
