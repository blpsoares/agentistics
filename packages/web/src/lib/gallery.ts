/**
 * gallery.ts — PURE: the files the PERSON SENT, grouped by the message that carried them.
 *
 * THE GALLERY IS NOT THE ARTIFACTS. `sessionArtifacts.ts` answers "what did this session WRITE";
 * this answers "what did I SEND it". They are opposite directions and share nothing but the panel
 * they are drawn in — a screenshot pasted into the composer is not a file the assistant produced,
 * and filing it under Files would be a claim about the session's work that nobody made.
 *
 * THE GROUPING IS THE FEATURE. Several images routinely go up in one message — three screenshots of
 * one broken layout — and a flat wall of thumbnails loses the one thing that makes them readable:
 * that they were sent TOGETHER, about the same thing, with the same sentence under them. So the
 * unit here is the MESSAGE, not the file, and every list in the panel is a list of messages whose
 * rows happen to be files.
 *
 * WHAT AN ATTACHMENT IS is decided by `messageAttachments.ts` and nothing here re-derives it: the
 * composer types a line into a tmux pane, so a sent message is attachment paths on their own
 * leading lines followed by the typed text, and `splitMessage` is the one rule that takes them
 * apart. WHO SENT IT is decided by `lastSent.ts`'s `isPersonMessage`, for the same reason it exists
 * there: the transcript files background tasks, injected reminders and `!` command output under the
 * user's own role, and a gallery of "what I sent" that included those would be showing somebody
 * their own avatar over something they never wrote.
 *
 * IT ONLY READS THE COMMITTED TRANSCRIPT. A message still in flight (the chat's `echo` list) is
 * deliberately absent: it lands in the transcript within a poll or two and arrives here then, and
 * an entry that cannot be anchored to a rendered turn is one whose "go to the message" has nowhere
 * to go.
 */

import { isPersonMessage, type SentTurn } from './lastSent'
import { attachmentName, isImageAttachment, splitMessage } from './messageAttachments'

/** The one field beyond `SentTurn` this module reads. Structural — it imports no view. */
export type GalleryTurn = SentTurn & { at?: string }

/** One file, as it was sent. */
export interface GalleryFile {
  /** The absolute path the message carried. The identity — the URL is built from its name. */
  path: string
  /** The file's own name, which is what a row shows. */
  name: string
  /**
   * Can a preview exist AT ALL — decided by extension, which is what can be known without the
   * bytes. False is not a failure: it means the row shows a name and says so, rather than a broken
   * image where a thumbnail was promised.
   */
  image: boolean
  /** The extension, uppercased, for the FORMAT column. `''` when the name carries none. */
  format: string
}

/** One message, and the files it carried. */
export interface GalleryGroup {
  /**
   * The message's position in the turns list.
   *
   * This is what `turnAnchorId('turn', index)` is built from, which is the whole reason it is
   * carried: "go to the message" resolves an element id, and an index from any other list would
   * resolve to a different bubble.
   */
  index: number
  /** When the transcript recorded the turn, ISO. Absent on a transcript that carries none. */
  at?: string
  /** What the person typed, with the attachment lines removed. `''` when they typed nothing. */
  text: string
  /** In the order they were attached. Never empty — a message with none is not a group. */
  files: GalleryFile[]
}

/** The extension, uppercased. `''` when there is none — never invented from the bytes. */
export function fileFormat(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toUpperCase()
}

/**
 * Every message that carried a file, in the transcript's own order.
 *
 * A message with words and no files is absent entirely — it is a message, not a gallery entry. A
 * message with files and no words is present with `text: ''`: the files ARE the message, and
 * dropping it because nobody typed anything would hide the sends most likely to be a screenshot
 * dropped in without comment.
 *
 * The same file sent in two messages yields two entries. They were sent twice, at two moments,
 * about two things; collapsing them would answer a question about the DISK when the question here
 * is about the conversation.
 */
export function galleryGroups(turns: readonly GalleryTurn[]): GalleryGroup[] {
  const out: GalleryGroup[] = []
  turns.forEach((turn, index) => {
    if (!isPersonMessage(turn)) return
    const { attachments, text } = splitMessage(turn.text)
    if (attachments.length === 0) return
    const files = attachments.map(path => {
      const name = attachmentName(path)
      return { path, name, image: isImageAttachment(path), format: fileFormat(name) }
    })
    out.push(turn.at ? { index, at: turn.at, text, files } : { index, text, files })
  })
  return out
}

/** One image in the flat run the lightbox steps through, and the message it came in. */
export interface GalleryImage {
  path: string
  group: GalleryGroup
}

/**
 * Every previewable image, flattened, in reading order.
 *
 * The lightbox's scope is the WHOLE gallery rather than one message — unlike the chat's, which is
 * scoped to the turn that opened it. In the chat you are reading a conversation and a jump to some
 * other message's picture answers a question nobody asked; here you are looking at the pictures,
 * and "the next one" plainly means the next one on the screen.
 *
 * Non-image files are absent: there is nothing to show large, and a lightbox that stepped onto one
 * would be a black rectangle with a filename.
 */
export function galleryImages(groups: readonly GalleryGroup[]): GalleryImage[] {
  const out: GalleryImage[] = []
  for (const group of groups) {
    for (const file of group.files) {
      if (file.image) out.push({ path: file.path, group })
    }
  }
  return out
}

/** How many files the gallery holds, for the tab's count. */
export function galleryFileCount(groups: readonly GalleryGroup[]): number {
  return groups.reduce((n, g) => n + g.files.length, 0)
}

/**
 * A byte count, in the shortest form that is still true — and `''` when there is no count.
 *
 * The empty string is the point: a size this panel could not obtain is shown as NOTHING, never as
 * `0 B` or `—`. A zero is a measurement and would be a confident wrong one; the same rule the
 * context gauge follows when it cannot know a window.
 */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

/** LIST reads, GRID looks. Both show the same rows under the same message headings. */
export type GalleryView = 'list' | 'grid'

/**
 * The remembered view, from whatever was in storage.
 *
 * GRID is the default because that is what a gallery is: the pictures are the content, and a panel
 * that opens on a column of filenames makes the reader press something before they can see
 * anything. Anything unrecognised — a value from a future version, a corrupted key, `null` from a
 * private window — reads as the default rather than throwing, which is the same call every other
 * remembered preference in this workspace makes.
 */
export function parseGalleryView(raw: string | null): GalleryView {
  return raw === 'list' ? 'list' : 'grid'
}
