/**
 * protocol.ts — the wire between the extension host and its webview, and the shapes the local
 * `agentop server` answers with.
 *
 * ONE rule governs everything here: the extension holds no rule about what a session may take.
 * Every `enabled` flag, every verb label and every refusal sentence arrives already decided from
 * `/api/fleet`, which resolves them through the same `sessionActions` the terminal cockpit resolves
 * every keypress against. A second implementation in an editor extension would be a third set of
 * rules — after the cockpit's and the browser's — and it would go wrong in the expensive direction:
 * offering "answer its question" on a numbered dialog belonging to a harness with no verified way
 * to pick, where the keystroke takes whichever option happens to be highlighted.
 *
 * The webview performs no HTTP of its own either. It could (a CSP `connect-src` would allow it),
 * but then a Remote-SSH or Codespaces window would be asking a `localhost` that is the BROWSER's,
 * not the machine the sessions run on. The extension host is the process that sits beside the
 * fleet, so it is the process that asks.
 */

/** Mirrors `FleetActionId` in `packages/server/server/sessions/fleet-row.ts`. */
export type FleetActionId =
  | 'approve' | 'prompt' | 'rename' | 'note' | 'task' | 'kill' | 'resume'
  | 'openTask' | 'finishTask'

/** The verbs that need a line of text before they can run. */
export const TEXT_VERBS: ReadonlySet<string> = new Set([
  'prompt', 'rename', 'note', 'task',
])

export type SessionState =
  | 'working' | 'waiting' | 'waiting-approval' | 'exited' | 'lost' | 'unknown' | 'closed'

export interface FleetVerb {
  action: string
  /** Already localized by the server, from the very map the cockpit prints. */
  label: string
  enabled: boolean
  /** Why it is off, when the row can say. Already localized. */
  reason?: string
}

export interface DialogOption {
  number: number
  label: string
  selected?: boolean
}

export interface FleetRow {
  id: string
  title: string
  harness: string
  cwd: string
  project: string
  state: SessionState
  stateLabel: string
  actionable: boolean
  task?: string
  note?: string
  model?: string
  conversationId?: string
  approvalLines?: string[]
  dialogOptions?: DialogOption[]
  approvalBlind?: string
  approveBlind?: string
  chooseBlind?: string
  conversationBlind?: string
  attachCommand: string
  verbs: FleetVerb[]
}

export interface FleetPayload {
  sessions: FleetRow[]
  attention: number
  /** Already-localized reason this list may not be the whole truth. Never an empty list alone. */
  unavailable?: string
  tasks: string[]
}

export interface HarnessOption {
  id: string
  label: string
  /** Suggestions to OFFER, never a validation list — the server refuses nothing on this basis. */
  modelSuggestions: string[]
  supportsModel: boolean
  /** A closed enum the CLI itself prints. Empty means the tool has no effort flag. */
  efforts: string[]
}

export interface ProjectOption {
  path: string
  label: string
  repo?: string
  detail: string
  source: string
}

export interface NewOptions {
  harnesses: HarnessOption[]
  projects: ProjectOption[]
  tasks: string[]
  unavailable?: string
}

export interface SpawnRequest {
  harness: string
  cwd: string
  task?: string
  prompt?: string
  model?: string
  effort?: string
  label?: string
}

/** One key press, in the browser's vocabulary — `KeyboardEvent.key` plus its modifiers. */
export interface KeyPress {
  key: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
}

/** How this window is doing at reaching the machine's server. */
export type LinkState =
  /** Answering. */
  | 'ok'
  /** Nothing is listening — the server is not running, or it is somewhere else. */
  | 'down'
  /**
   * It answered, and said no. A central (which hosts no sessions) or an exposure profile with no
   * host power. Distinct from `down` on purpose: "cannot ask" and "nobody answered" are different
   * facts and send the user to different places.
   */
  | 'refused'

export interface LinkStatus {
  state: LinkState
  /** The endpoint being asked, so a wrong port is visible rather than mysterious. */
  url: string
  /** Already-localized sentence for the refusal, when the server gave one. */
  detail?: string
}

/**
 * What a surface is showing.
 *
 * The sidebar starts on `list` and walks into a session and back. An editor TAB is created pinned
 * to one session and has no list to return to — which is what lets several be open at once, one per
 * session, each keeping its own scroll and its own composer.
 */
export type Route =
  | { view: 'list' }
  | { view: 'session'; id: string }

/** Extension host → webview. */
export type HostMessage =
  | { type: 'state'; link: LinkStatus; fleet: FleetPayload; strings: Record<string, string>; lang: 'en' | 'pt' }
  /** How this surface opens, and whether it may navigate. Sent once, before anything else. */
  | { type: 'mount'; route: Route; pinned: boolean; theme: 'dark' | 'light' }
  /** The editor's theme changed under a surface that is already open. */
  | { type: 'theme'; theme: 'dark' | 'light' }
  /** One event off `/api/fleet/stream`, forwarded verbatim so the existing parsers read it. */
  | { type: 'terminal'; id: string; event: 'open' | 'frame' | 'end' | 'stall' | 'error'; data: string }
  | { type: 'newOptions'; options: NewOptions }
  | { type: 'result'; ok: boolean; message: string }
  | { type: 'busy'; id: string; busy: boolean }
  /**
   * Open the wizard, optionally already pointed at a directory.
   *
   * The directory is what makes "start a session HERE" mean anything from the command palette: the
   * open workspace folder is the one place the editor knows about that the server cannot guess.
   */
  | { type: 'openWizard'; cwd?: string }

/** Webview → extension host. */
export type ViewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'act'; id: string; action: FleetActionId; text?: string; choice?: number }
  | { type: 'attach'; id: string }
  | { type: 'copy'; text: string }
  | { type: 'openFolder'; path: string }
  | { type: 'newOptions'; query: string }
  | { type: 'spawn'; request: SpawnRequest; attach: boolean }
  | { type: 'openDashboard' }
  | { type: 'startServer' }
  /** Start / stop receiving this session's screen. The host shares one stream per session. */
  | { type: 'watch'; id: string }
  | { type: 'unwatch'; id: string }
  /** Open this session as its own editor tab — several may be open at once. */
  | { type: 'openTab'; id: string }
  /**
   * A keystroke, or literal characters, straight into the live session.
   *
   * The browser's own key vocabulary travels; the mapping to tmux's happens on the server, which
   * has to validate it anyway (`fleet-input.ts`). No result comes back for a successful key — a
   * toast per keystroke is not feedback, the screen is; only a REFUSAL is reported.
   */
  | { type: 'input'; id: string; text?: string; key?: KeyPress }
