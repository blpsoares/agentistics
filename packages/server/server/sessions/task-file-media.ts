/**
 * task-file-media.ts — PURE: what to serve a task file's bytes AS, by its own stored name.
 *
 * `/api/task-files/:id` (t-918cc82233) used to answer every file — a screenshot, a PDF spec, a
 * pasted-text attachment — with `Content-Type: application/octet-stream` plus an unconditional
 * `Content-Disposition: attachment`. That is right for the "Download" link `TaskFiles.tsx` already
 * draws, and wrong for a PREVIEW: an `<iframe>` pointed at a response carrying `attachment` is
 * downloaded by every major browser rather than rendered, whatever is inside it — verified live,
 * clicking a pasted-text chip in the staged-session compose wizard triggered a file save instead of
 * opening `AttachmentLightbox`'s viewer, exactly the "abrir os arquivos… texto" the feature exists
 * for. An `<img>` tag is the one exception (browsers render it regardless of the disposition
 * header, which is why `TaskFiles.tsx`'s own picture grid never showed the bug), so it went
 * unnoticed until the PDF/text branch was exercised.
 *
 * Deliberately its OWN closed table rather than an extension of `attachment-web.ts`'s — that one
 * serves the session composer's own uploads, typed into a live assistant's tmux pane, a different
 * and more sensitive trust boundary; widening it to add a `text` kind for the board's files would
 * change behaviour on a route this module has nothing to do with. A task file is board content —
 * specs, plans, pasted notes an assistant or a person wrote — and `text` belongs here alone.
 *
 * A CLOSED TABLE, never a default: an extension absent here answers `null` and the caller keeps the
 * original `application/octet-stream` + `attachment` fallback, so an unrecognised or genuinely
 * binary upload (a `.docx`, a `.zip`) still only ever offers to download — never inline-served
 * guesswork. Read off the EXTENSION and never sniffed, paired with the `nosniff` + CSP this app's
 * `securityHeaders` wrapper already sets on every `/api/` response.
 */

export type TaskFileKind = 'image' | 'video' | 'pdf' | 'text'

export interface TaskFileMedia {
  mime: string
  kind: TaskFileKind
  /** Whether this kind gets `Content-Disposition: inline` — false for image/video, which need no
   *  disposition at all (an `<img>`/`<video>` never offers to save under a name), same rule
   *  `attachment-web.ts`'s `attachmentMediaType` already applies to its own `pdf` kind. */
  inline: boolean
}

const TASK_FILE_TYPES: Record<string, TaskFileMedia> = {
  png: { mime: 'image/png', kind: 'image', inline: false },
  jpg: { mime: 'image/jpeg', kind: 'image', inline: false },
  jpeg: { mime: 'image/jpeg', kind: 'image', inline: false },
  gif: { mime: 'image/gif', kind: 'image', inline: false },
  webp: { mime: 'image/webp', kind: 'image', inline: false },
  avif: { mime: 'image/avif', kind: 'image', inline: false },
  bmp: { mime: 'image/bmp', kind: 'image', inline: false },
  svg: { mime: 'image/svg+xml', kind: 'image', inline: false },
  mp4: { mime: 'video/mp4', kind: 'video', inline: false },
  m4v: { mime: 'video/mp4', kind: 'video', inline: false },
  mov: { mime: 'video/quicktime', kind: 'video', inline: false },
  webm: { mime: 'video/webm', kind: 'video', inline: false },
  ogv: { mime: 'video/ogg', kind: 'video', inline: false },
  pdf: { mime: 'application/pdf', kind: 'pdf', inline: true },
  // TEXT — the kind the sibling table has none of, because this is the one route that needs it.
  // `text/plain` (never `text/html` or a specific language type) for every one of these: it is
  // never executed as markup, only shown literally, which is what keeps a `.md` or `.log` safe to
  // serve inline under `nosniff`.
  txt: { mime: 'text/plain; charset=utf-8', kind: 'text', inline: true },
  md: { mime: 'text/plain; charset=utf-8', kind: 'text', inline: true },
  markdown: { mime: 'text/plain; charset=utf-8', kind: 'text', inline: true },
  log: { mime: 'text/plain; charset=utf-8', kind: 'text', inline: true },
  csv: { mime: 'text/plain; charset=utf-8', kind: 'text', inline: true },
  json: { mime: 'text/plain; charset=utf-8', kind: 'text', inline: true },
  yaml: { mime: 'text/plain; charset=utf-8', kind: 'text', inline: true },
  yml: { mime: 'text/plain; charset=utf-8', kind: 'text', inline: true },
}

/** What to serve this stored task file as, or `null` when the extension names nothing here — the
 *  caller keeps its own `application/octet-stream` + `attachment` fallback for that case. */
export function taskFileMediaType(name: string): TaskFileMedia | null {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  return TASK_FILE_TYPES[name.slice(dot + 1).toLowerCase()] ?? null
}
